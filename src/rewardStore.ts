import { App, normalizePath, TFile, TFolder } from "obsidian";
import { BrewinHabitsSettings } from "./settings";
import { coerceISO, todayISO } from "./dates";
import { combinedChance, isBacklogBlocked, resolveCashIn, settleHabitAction, todaysChance, vicesSlippedOn } from "./rewards";
import { backlogItemsFor, ExternalBacklog } from "./backlog";
import { Habit, Redemption, Reward, RewardsState } from "./types";

/** One well-known note per vault, not "many notes matching a tag" — a running points balance
 *  and a small reward catalog are a singleton, unlike tasks/events/habits. Lives alongside
 *  habit notes so it doesn't need its own settings field. */
const REWARDS_FILE = "Rewards.md";

function asRewardList(v: unknown): Reward[] {
  if (!Array.isArray(v)) return [];
  const out: Reward[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const cost = Number(o.cost);
    if (!name || !Number.isFinite(cost) || cost <= 0) continue;
    out.push({ name, cost: Math.round(cost) });
  }
  return out;
}

function asISOList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => coerceISO(x)).filter((x): x is string => !!x);
}

function asRedemptionList(v: unknown): Redemption[] {
  if (!Array.isArray(v)) return [];
  const out: Redemption[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const date = coerceISO(o.date);
    const reward = typeof o.reward === "string" ? o.reward : "";
    const cost = Number(o.cost);
    if (!date || !reward || !Number.isFinite(cost)) continue;
    out.push({ date, reward, cost: Math.round(cost), won: Boolean(o.won) });
  }
  return out;
}

/** Rewards.md frontmatter → typed state. Points may be negative (see rewards.ts). */
function stateFromFrontmatter(fm: Record<string, unknown>): RewardsState {
  const points = Number(fm.points);
  return {
    points: Number.isFinite(points) ? Math.round(points) : 0,
    rewards: asRewardList(fm.rewards),
    perfectDays: asISOList(fm.perfect_days),
    redemptions: asRedemptionList(fm.redemptions),
  };
}

export class RewardStore {
  /** The state this store last wrote, served until the metadata cache catches up with the write
   *  (`forget`) — same reason as HabitStore's overlay. */
  private written: RewardsState | null = null;

  constructor(private app: App, private settings: BrewinHabitsSettings) {}

  get notePath(): string {
    return this.path;
  }

  /** The cache now reflects Rewards.md (or it changed underneath us) — read it again. */
  forget(): void {
    this.written = null;
  }

  private get path(): string {
    return normalizePath(`${this.settings.habitsFolder}/${REWARDS_FILE}`);
  }

  private async ensureFolder(): Promise<void> {
    const norm = normalizePath(this.settings.habitsFolder);
    if (this.app.vault.getAbstractFileByPath(norm) instanceof TFolder) return;
    if (this.app.vault.getAbstractFileByPath(norm)) return;
    try {
      await this.app.vault.createFolder(norm);
    } catch {
      /* already exists / race */
    }
  }

  /** Create the note on first touch — same lazy-create pattern habitStore/eventStore use for
   *  their own folders. No `habit` tag: this must never be mistaken for a trackable habit. */
  private async ensureFile(): Promise<TFile> {
    const existing = this.app.vault.getAbstractFileByPath(this.path);
    if (existing instanceof TFile) return existing;
    await this.ensureFolder();
    const lines = [
      "---",
      "points: 0",
      "rewards: []",
      "perfect_days: []",
      "redemptions: []",
      "---",
      "",
      "# Rewards",
      "",
      "Points and history here are maintained automatically as habits are marked. Add, edit or " +
        "remove rewards from the Habits pane.",
      "",
    ];
    return this.app.vault.create(this.path, lines.join("\n"));
  }

  async getState(): Promise<RewardsState> {
    const file = await this.ensureFile();
    if (this.written) return this.written;
    return stateFromFrontmatter((this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>);
  }

  /**
   * Read-modify-write the reward state against the FILE's current frontmatter, inside one
   * `processFrontMatter` call — so two quick taps can't each read the same stale balance and the
   * second overwrite the first. `change` returns the new state, or null to leave the file alone.
   */
  private async update(change: (current: RewardsState) => RewardsState | null): Promise<RewardsState | null> {
    const file = await this.ensureFile();
    let next = null as RewardsState | null;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      next = change(stateFromFrontmatter(fm as Record<string, unknown>));
      if (!next) return;
      fm.points = Math.round(next.points);
      fm.rewards = next.rewards;
      fm.perfect_days = [...next.perfectDays].sort();
      fm.redemptions = next.redemptions;
    });
    if (next) this.written = next;
    return next;
  }

  async addReward(name: string, cost: number): Promise<void> {
    const clean = name.trim();
    if (!clean) return;
    await this.update((state) => ({
      ...state,
      rewards: [...state.rewards.filter((r) => r.name !== clean), { name: clean, cost: Math.max(1, Math.round(cost)) }],
    }));
  }

  async editReward(oldName: string, name: string, cost: number): Promise<void> {
    const clean = name.trim();
    if (!clean) return;
    await this.update((state) => ({
      ...state,
      // Renaming onto another reward's name replaces that one rather than leaving two entries
      // the catalogue could never tell apart. The edited reward keeps its place in the list.
      rewards: state.rewards
        .filter((r) => r.name === oldName || r.name !== clean)
        .map((r) => (r.name === oldName ? { name: clean, cost: Math.max(1, Math.round(cost)) } : r)),
    }));
  }

  async removeReward(name: string): Promise<void> {
    await this.update((state) => ({ ...state, rewards: state.rewards.filter((r) => r.name !== name) }));
  }

  /**
   * Call once after every HabitStore write, with the `before`/`after` that write returned (the
   * file's own contents, not the cache's). `allHabits` must already contain `after` — HabitStore's
   * reads do, straight after its own write. See `settleHabitAction` for the rules.
   */
  async recordHabitAction(before: Habit, after: Habit, allHabits: Habit[], dateISO = todayISO()): Promise<void> {
    await this.update((state) =>
      settleHabitAction(state, before, after, allHabits, dateISO, this.settings.pointsPerCompletion, this.settings.perfectDayBonus)
    );
  }

  /** Habits behind plus whatever the sibling plugins report — the number behind the chance and
   *  the block, exposed separately so the UI can show a breakdown. */
  backlogItems(allHabits: Habit[], ext: ExternalBacklog, dateISO = todayISO()): number {
    return backlogItemsFor(allHabits, ext, dateISO, this.settings.backlogWindowDays);
  }

  /** Today's cash-in odds (a percentage), given the current habit list and the sibling plugins'
   *  reported backlog. With the feature disabled this is identical to the original vice-only
   *  chance. */
  chanceToday(allHabits: Habit[], ext: ExternalBacklog, dateISO = todayISO()): number {
    const slipped = vicesSlippedOn(allHabits, dateISO);
    if (!this.settings.crossPluginBacklogEnabled) {
      return todaysChance(slipped, this.settings.rewardBaseChance, this.settings.rewardChancePenaltyPerVice, this.settings.rewardMinChance);
    }
    return combinedChance(
      slipped,
      this.backlogItems(allHabits, ext, dateISO),
      this.settings.rewardBaseChance,
      this.settings.rewardChancePenaltyPerVice,
      this.settings.rewardChancePenaltyPerBacklogItem,
      this.settings.rewardMinChance
    );
  }

  async cashIn(
    rewardName: string,
    allHabits: Habit[],
    ext: ExternalBacklog,
    dateISO = todayISO()
  ): Promise<{ ok: boolean; won?: boolean; reason?: string }> {
    if (this.settings.crossPluginBacklogEnabled) {
      const backlog = this.backlogItems(allHabits, ext, dateISO);
      if (isBacklogBlocked(backlog, this.settings.rewardBacklogBlockThreshold)) {
        return { ok: false, reason: "Too far behind to cash in right now — catch up first." };
      }
    }
    const chance = this.chanceToday(allHabits, ext, dateISO);
    let outcome: { ok: boolean; won?: boolean; reason?: string } = { ok: false, reason: "Couldn't cash in." };
    await this.update((state) => {
      const res = resolveCashIn(state, rewardName, chance, dateISO, Math.random);
      outcome = res.ok ? { ok: true, won: res.won } : { ok: false, reason: res.reason };
      return res.ok ? res.state! : null;
    });
    return outcome;
  }
}

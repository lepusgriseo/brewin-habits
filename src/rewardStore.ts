import { App, normalizePath, TFile, TFolder } from "obsidian";
import { BrewinHabitsSettings } from "./settings";
import { coerceISO, todayISO } from "./dates";
import { isDueOn, isSatisfied } from "./habit";
import {
  applyCompletionTransition,
  combinedChance,
  isBacklogBlocked,
  isPerfectDay,
  resolveCashIn,
  syncPerfectDay,
  todaysChance,
  vicesSlippedOn,
} from "./rewards";
import { crossPluginBacklogItems, dueUnmetToday, habitBacklogDays, ExternalBacklog } from "./backlog";
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

export class RewardStore {
  constructor(private app: App, private settings: BrewinHabitsSettings) {}

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
    const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
    const points = Number(fm.points);
    return {
      points: Number.isFinite(points) && points > 0 ? Math.round(points) : 0,
      rewards: asRewardList(fm.rewards),
      perfectDays: asISOList(fm.perfect_days),
      redemptions: asRedemptionList(fm.redemptions),
    };
  }

  private async persist(state: RewardsState): Promise<void> {
    const file = await this.ensureFile();
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.points = Math.max(0, Math.round(state.points));
      fm.rewards = state.rewards;
      fm.perfect_days = [...state.perfectDays].sort();
      fm.redemptions = state.redemptions;
    });
  }

  async addReward(name: string, cost: number): Promise<void> {
    const clean = name.trim();
    if (!clean) return;
    const state = await this.getState();
    const rewards = [...state.rewards.filter((r) => r.name !== clean), { name: clean, cost: Math.max(1, Math.round(cost)) }];
    await this.persist({ ...state, rewards });
  }

  async editReward(oldName: string, name: string, cost: number): Promise<void> {
    const clean = name.trim();
    if (!clean) return;
    const state = await this.getState();
    const rewards = state.rewards.map((r) =>
      r.name === oldName ? { name: clean, cost: Math.max(1, Math.round(cost)) } : r
    );
    await this.persist({ ...state, rewards });
  }

  async removeReward(name: string): Promise<void> {
    const state = await this.getState();
    await this.persist({ ...state, rewards: state.rewards.filter((r) => r.name !== name) });
  }

  /**
   * Call once after every `HabitStore.mark()`. `before`/`after` are the SAME habit's state
   * either side of the mark; `allHabits` is the fresh full list, used to re-check whether today
   * counts as a perfect day. Due-ness is folded into "satisfied" here — a habit that isn't due
   * today can't earn or lose points today, regardless of its raw logged value.
   */
  async recordHabitAction(before: Habit, after: Habit, allHabits: Habit[], dateISO = todayISO()): Promise<void> {
    let state = await this.getState();
    const wasSatisfied = isDueOn(before, dateISO) && isSatisfied(before, dateISO);
    const isSatisfiedNow = isDueOn(after, dateISO) && isSatisfied(after, dateISO);
    state = applyCompletionTransition(state, wasSatisfied, isSatisfiedNow, this.settings.pointsPerCompletion);
    state = syncPerfectDay(state, dateISO, isPerfectDay(allHabits, dateISO), this.settings.perfectDayBonus);
    await this.persist(state);
  }

  /** Habits' own unmet-today + trailing-window backlog, plus whatever the sibling plugins
   *  report. Exposed separately from chanceToday so the UI can show a breakdown. */
  backlogItems(allHabits: Habit[], ext: ExternalBacklog, dateISO = todayISO()): number {
    return (
      dueUnmetToday(allHabits, dateISO) +
      habitBacklogDays(allHabits, dateISO, this.settings.backlogWindowDays) +
      crossPluginBacklogItems(ext)
    );
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
    const state = await this.getState();
    const chance = this.chanceToday(allHabits, ext, dateISO);
    const res = resolveCashIn(state, rewardName, chance, dateISO, Math.random);
    if (!res.ok) return { ok: false, reason: res.reason };
    await this.persist(res.state!);
    return { ok: true, won: res.won };
  }
}

import { ItemView, Menu, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { currentStreak, heatmapCells, isBreach, isDueOn, isVice, valueOn } from "./habit";
import { addDays, formatISO, parseISO, todayISO } from "./dates";
import { HabitModal } from "./habitModal";
import { LogDayModal } from "./logDayModal";
import { RewardModal } from "./rewardModal";
import { ConfirmModal } from "./confirmModal";
import { habitsBehind, ExternalBacklog } from "./backlog";
import { isBacklogBlocked } from "./rewards";
import type BrewinHabitsPlugin from "./main";
import type { HabitChange } from "./habitStore";
import { Habit, Reward } from "./types";

export const HABIT_VIEW_TYPE = "brewin-habits";

/** Whether the rewards box is open is remembered per device — a convenience, so storage that
 *  isn't there (private window, cleared site data) just means it starts folded. */
const REWARDS_OPEN_KEY = "brewin-habits:rewards-open";

function loadRewardsOpen(): boolean {
  try {
    return window.localStorage.getItem(REWARDS_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function saveRewardsOpen(open: boolean): void {
  try {
    window.localStorage.setItem(REWARDS_OPEN_KEY, open ? "1" : "0");
  } catch {
    /* not available — the state just isn't remembered */
  }
}

/** Default date for the "log a past day" dialog — the most common thing you forgot. */
function yesterday(): string {
  return formatISO(addDays(parseISO(todayISO())!, -1));
}

/** A text-less button: Obsidian's `clickable-icon` styling (transparent, no button chrome — its
 *  `button:not(.clickable-icon)` rule otherwise paints every button grey) plus a spoken label. */
function iconButton(parent: HTMLElement, glyph: string, label: string, extraCls = ""): HTMLButtonElement {
  const b = parent.createEl("button", { text: glyph, cls: `clickable-icon brewin-icon-btn ${extraCls}`.trim() });
  b.setAttr("aria-label", label);
  return b;
}

export class HabitView extends ItemView {
  /** Starts folded: the habits are what you come here to act on, not the catalogue. */
  private rewardsOpen = loadRewardsOpen();

  constructor(leaf: WorkspaceLeaf, private plugin: BrewinHabitsPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return HABIT_VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Habits";
  }
  getIcon(): string {
    return "flame";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("brewin-habits");
    const today = todayISO();

    const toolbar = root.createDiv({ cls: "brewin-toolbar" });
    toolbar.createEl("button", { text: "＋ New habit", cls: "mod-cta" }).addEventListener("click", () => {
      new HabitModal(this.app, this.plugin.habits, () => this.render()).open();
    });
    iconButton(toolbar, "⟳", "Refresh").addEventListener("click", () => this.render());

    const everything = this.plugin.habits.getHabits();
    const all = everything.filter((h) => h.active);
    const paused = everything.filter((h) => !h.active);

    // Rewards render regardless of whether any habits exist yet — a catalog and a balance can
    // outlive the habits that earned them, and shouldn't disappear along with the last one.
    await this.renderRewards(root, all, today);

    if (!all.length) {
      root.createDiv({
        cls: "brewin-empty",
        text: paused.length ? "No active habits. Press ＋ New habit, or resume one below." : "No habits yet. Press ＋ New habit.",
      });
    }

    const habits = all.filter((h) => !isVice(h));
    const vices = all.filter((h) => isVice(h));

    // Habits: due today first, since those are the ones to act on.
    const due = habits.filter((h) => isDueOn(h, today));
    const rest = habits.filter((h) => !isDueOn(h, today));
    if (due.length) root.createDiv({ cls: "brewin-section-header", text: "📌 Due today" });
    due.forEach((h) => this.habitCard(root, h, today, true));
    if (rest.length) root.createDiv({ cls: "brewin-section-header", text: "🗓 Not due today" });
    rest.forEach((h) => this.habitCard(root, h, today, false));

    // Vices are tracked the other way round — a clean day is one you didn't log.
    if (vices.length) {
      root.createDiv({ cls: "brewin-section-header brewin-vices-header", text: "🚭 Vices" });
      vices.forEach((h) => this.habitCard(root, h, today, isDueOn(h, today)));
    }

    if (paused.length) this.renderPaused(root, paused);
  }

  /**
   * Points balance, today's cash-in chance, the reward catalog, and recent history. Folded, it is
   * one line — balance and odds (or 🔒) — so it never pushes the habits off the first screen.
   */
  private async renderRewards(root: HTMLElement, allHabits: Habit[], today: string): Promise<void> {
    const state = await this.plugin.rewards.getState();
    const ext = this.plugin.backlog.readExternal();
    const chance = this.plugin.rewards.chanceToday(allHabits, ext, today);
    const backlogOn = this.plugin.settings.crossPluginBacklogEnabled;
    const backlogItems = this.plugin.rewards.backlogItems(allHabits, ext, today);
    const blocked = backlogOn && isBacklogBlocked(backlogItems, this.plugin.settings.rewardBacklogBlockThreshold);

    const open = this.rewardsOpen;
    const box = root.createDiv({ cls: "brewin-rewards" + (open ? "" : " is-collapsed") });
    const head = box.createDiv({ cls: "brewin-rewards-head" });
    head.createSpan({ cls: "brewin-expander", text: open ? "▾" : "▸" });
    head.createEl("h4", { text: "🎁 Rewards" });
    head.createSpan({ cls: "brewin-rewards-points", text: `${state.points} pts` });
    head.createSpan({
      cls: "brewin-rewards-odds" + (blocked ? " is-blocked" : ""),
      text: blocked ? "🔒" : `${chance}%`,
      attr: { "aria-label": blocked ? "Cash-in blocked" : `Cash-in chance ${chance}%` },
    });
    head.setAttr("role", "button");
    head.setAttr("tabindex", "0");
    head.setAttr("aria-expanded", String(open));
    head.setAttr("aria-label", open ? "Collapse rewards" : "Expand rewards");
    const toggle = () => {
      this.rewardsOpen = !this.rewardsOpen;
      saveRewardsOpen(this.rewardsOpen);
      void this.render();
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
    if (!open) return;

    box.createDiv({ cls: "brewin-rewards-chance", text: `Cash-in chance today: ${chance}%` });

    if (backlogOn && backlogItems > 0) {
      box.createDiv({
        cls: "brewin-rewards-backlog" + (blocked ? " brewin-rewards-blocked" : ""),
        text: this.backlogLine(allHabits, ext, today) + (blocked ? " — cash-in blocked" : ""),
      });
    }

    const list = box.createDiv({ cls: "brewin-rewards-list" });
    if (!state.rewards.length) {
      list.createDiv({ cls: "brewin-empty-small", text: "No rewards yet — add one below." });
    }
    for (const reward of state.rewards) {
      const row = list.createDiv({ cls: "brewin-rewards-row" });
      row.createSpan({ cls: "brewin-rewards-name", text: reward.name });
      row.createSpan({ cls: "brewin-rewards-cost", text: `${reward.cost} pts` });
      const actions = row.createDiv({ cls: "brewin-rewards-actions" });
      const cashBtn = actions.createEl("button", {
        text: blocked ? "🔒 Too far behind" : "🎲 Cash in",
        cls: "brewin-chip brewin-chip-mini",
      });
      const affordable = state.points >= reward.cost;
      const disabled = !affordable || blocked;
      cashBtn.toggleClass("brewin-chip-disabled", disabled);
      cashBtn.addEventListener("click", () => {
        if (!disabled) this.confirmCashIn(reward, chance, allHabits, ext, today);
      });
      iconButton(actions, "✎", `Edit ${reward.name}`).addEventListener("click", () => {
        new RewardModal(this.app, this.plugin.rewards, () => this.render(), reward).open();
      });
      iconButton(actions, "🗑", `Delete ${reward.name}`).addEventListener("click", () => this.confirmRemoveReward(reward));
    }

    box.createEl("button", { text: "＋ Add reward", cls: "brewin-chip brewin-chip-mini" }).addEventListener("click", () => {
      new RewardModal(this.app, this.plugin.rewards, () => this.render()).open();
    });

    if (state.redemptions.length) {
      const hist = box.createDiv({ cls: "brewin-rewards-history" });
      hist.createDiv({ cls: "brewin-rewards-history-label", text: "Recent" });
      for (const r of state.redemptions.slice(0, 5)) {
        hist.createDiv({
          cls: "brewin-rewards-history-row" + (r.won ? " won" : " lost"),
          text: `${r.date} — ${r.reward} (${r.cost} pts) — ${r.won ? "won 🎉" : "no luck"}`,
        });
      }
    }
  }

  /** The odds and the cost are stated up front — nothing fires on a stray click, and the stake
   *  (points spend regardless of outcome) is never a surprise after the fact. */
  private confirmCashIn(reward: Reward, chance: number, allHabits: Habit[], ext: ExternalBacklog, today: string): void {
    new ConfirmModal(this.app, {
      title: "Cash in?",
      body: `"${reward.name}" costs ${reward.cost} points and has a ${chance}% chance of succeeding today. Points are spent either way.`,
      cta: "Cash in",
      onConfirm: async () => {
        const res = await this.plugin.rewards.cashIn(reward.name, allHabits, ext, today);
        if (!res.ok) {
          new Notice(res.reason ?? "Couldn't cash in.");
          return;
        }
        new Notice(res.won ? `🎉 You got it — "${reward.name}"!` : `No luck this time — "${reward.name}" slipped away.`);
        this.render();
      },
    }).open();
  }

  private confirmRemoveReward(reward: Reward): void {
    new ConfirmModal(this.app, {
      title: "Delete reward?",
      body: `"${reward.name}" (${reward.cost} pts) will be removed from the catalogue. Your points and past cash-ins are kept.`,
      cta: "Delete",
      onConfirm: async () => {
        await this.plugin.rewards.removeReward(reward.name);
        this.render();
      },
    }).open();
  }

  /** "Backlog: 3 tasks overdue · 1 fitness session missed · 2 habits behind" — the breakdown
   *  behind the chance/block, so the number moving is never a mystery. */
  private backlogLine(allHabits: Habit[], ext: ExternalBacklog, today: string): string {
    const bits: string[] = [];
    if (ext.tasksOverdue) bits.push(`${ext.tasksOverdue} task${ext.tasksOverdue === 1 ? "" : "s"} overdue`);
    if (ext.tasksSlipped) bits.push(`${ext.tasksSlipped} slipped`);
    if (ext.fitnessMissed) bits.push(`${ext.fitnessMissed} fitness session${ext.fitnessMissed === 1 ? "" : "s"} missed`);
    const behind = habitsBehind(allHabits, today, this.plugin.settings.backlogWindowDays);
    if (behind) bits.push(`${behind} habit${behind === 1 ? "" : "s"} behind`);
    return `Backlog: ${bits.join(" · ")}`;
  }

  private habitCard(parent: HTMLElement, habit: Habit, today: string, dueToday: boolean): void {
    const vice = isVice(habit);
    const card = parent.createDiv({ cls: "brewin-habit-card" + (vice ? " brewin-vice-card" : "") });

    const head = card.createDiv({ cls: "brewin-habit-head" });
    const titleWrap = head.createDiv({ cls: "brewin-habit-titlewrap" });
    const link = titleWrap.createSpan({ cls: "brewin-task-link brewin-habit-title", text: habit.title });
    link.addEventListener("click", () => this.openNote(habit.path));
    const streak = currentStreak(habit, today);
    // For a vice the streak is consecutive CLEAN days, which is the thing worth counting.
    titleWrap.createSpan({
      cls: "brewin-habit-streak",
      text: streak > 0 ? (vice ? `🌱 ${streak} clean` : `🔥 ${streak}`) : "—",
    });
    if (vice && isBreach(habit, today)) {
      titleWrap.createSpan({ cls: "brewin-vice-breach", text: "over" });
    }

    // Today control
    const ctrl = head.createDiv({ cls: "brewin-habit-ctrl" });
    const val = valueOn(habit, today);
    if (habit.kind === "binary") {
      // A binary vice logs a slip, so the button's meaning flips.
      const logged = val > 0;
      const btn = ctrl.createEl("button", {
        cls: "brewin-habit-check" + (logged ? (vice ? " breach" : " done") : ""),
        text: vice ? (logged ? "✗ Slipped" : "Log a slip") : logged ? "✓ Done" : "Mark done",
      });
      if (!vice) btn.toggleClass("brewin-disabled", !dueToday && !logged);
      btn.addEventListener("click", () => this.markAndReward(habit, "toggle"));
    } else {
      const unit = habit.unit ? " " + habit.unit : "";
      const minus = ctrl.createEl("button", { cls: "brewin-habit-step", text: "−" });
      minus.setAttr("aria-label", `Less ${habit.title}`);
      // Nothing to take away at zero; and like the yes/no button, a habit that isn't due today
      // can't be added to (it would earn nothing), only corrected back down.
      minus.toggleClass("brewin-disabled", val <= 0);
      minus.addEventListener("click", () => this.markAndReward(habit, "dec"));
      ctrl.createSpan({
        cls: "brewin-habit-count" + (vice && val > habit.target ? " breach" : ""),
        // For a vice the target is a ceiling — say so in words rather than "0 / 0 max".
        text: vice
          ? `${val}${unit} today · ${habit.target > 0 ? `${habit.target}${unit} allowed` : "none allowed"}`
          : `${val} / ${habit.target}${unit}`,
      });
      const plus = ctrl.createEl("button", { cls: "brewin-habit-step", text: "＋" });
      plus.setAttr("aria-label", `More ${habit.title}`);
      if (!vice) plus.toggleClass("brewin-disabled", !dueToday);
      plus.addEventListener("click", () => this.markAndReward(habit, "inc"));
    }

    // Everything less frequent than today's tap lives behind one button, so the row stays short
    // on a phone. The heatmap's past cells are also a shortcut into "log a past day".
    iconButton(ctrl, "⋯", `More actions for ${habit.title}`, "brewin-habit-more").addEventListener("click", (evt) => {
      const menu = new Menu();
      menu.addItem((i) => i.setTitle("Log a past day…").setIcon("calendar").onClick(() => this.openLogDay(habit, yesterday())));
      menu.addItem((i) => i.setTitle("Pause habit").setIcon("pause").onClick(() => this.confirmPause(habit)));
      menu.addItem((i) => i.setTitle("Open note").setIcon("file-text").onClick(() => this.openNote(habit.path)));
      menu.showAtMouseEvent(evt);
    });

    // Heatmap
    this.heatmap(card, habit, today);
  }

  /** Paused habits stop counting as due, missed or behind, and drop out of the cards above — but
   *  stay listed here so they can be resumed, rather than vanishing. */
  private renderPaused(root: HTMLElement, paused: Habit[]): void {
    root.createDiv({ cls: "brewin-section-header", text: "⏸ Paused" });
    const list = root.createDiv({ cls: "brewin-paused-list" });
    for (const habit of paused) {
      const row = list.createDiv({ cls: "brewin-paused-row" });
      const link = row.createSpan({ cls: "brewin-task-link brewin-paused-title", text: (isVice(habit) ? "🚭 " : "") + habit.title });
      link.addEventListener("click", () => this.openNote(habit.path));
      row.createEl("button", { text: "Resume", cls: "brewin-chip brewin-chip-mini" }).addEventListener("click", async () => {
        await this.plugin.habits.setActive(habit, true);
        new Notice(`${habit.title} resumed.`);
        this.render();
      });
    }
  }

  private confirmPause(habit: Habit): void {
    new ConfirmModal(this.app, {
      title: `Pause ${habit.title}?`,
      body:
        "While paused it isn't due, can't be missed, and doesn't count toward the backlog or a perfect day. " +
        "Its history is kept, and you can resume it from the Paused list.",
      cta: "Pause",
      onConfirm: async () => {
        await this.plugin.habits.setActive(habit, false);
        new Notice(`${habit.title} paused.`);
        this.render();
      },
    }).open();
  }

  /**
   * Mark a habit, then let the rewards store settle points/perfect-day against what was actually
   * written. Kept as one shared path (rather than repeating this at each of the three mark call
   * sites) so the two stores can never drift out of sync with each other.
   */
  private async markAndReward(habit: Habit, action: "toggle" | "inc" | "dec"): Promise<void> {
    const today = todayISO();
    const change = await this.plugin.habits.mark(habit, action, today);
    if (!change) return;
    await this.settle(change, today);
    this.render();
  }

  /** Settle rewards for one write. `before`/`after` come from the file itself (never the possibly
   *  stale cache); the habit list gets `after` substituted so the perfect-day check sees it. */
  private async settle(change: HabitChange, dateISO: string): Promise<void> {
    const allHabits = this.plugin.habits
      .getHabits()
      .map((h) => (h.path === change.after.path ? { ...h, log: change.after.log } : h));
    await this.plugin.rewards.recordHabitAction(change.before, change.after, allHabits, dateISO);
  }

  private openLogDay(habit: Habit, startDate: string): void {
    new LogDayModal(this.app, habit, startDate, (dateISO, value) => this.logDay(habit, dateISO, value)).open();
  }

  /**
   * Back-fill an absolute value for one past day, then re-settle rewards for THAT date — the
   * same transition-based award/claw-back the today path uses (`recordHabitAction` is
   * date-parameterised), so points and perfect-day bonuses stay consistent with real history.
   */
  private async logDay(habit: Habit, dateISO: string, value: number): Promise<void> {
    const change = await this.plugin.habits.setValue(habit, dateISO, value);
    if (!change) return;
    await this.settle(change, dateISO);
    new Notice(`${habit.title}: ${dateISO} updated.`);
    this.render();
  }

  private heatmap(parent: HTMLElement, habit: Habit, today: string): void {
    const vice = isVice(habit);
    const wrap = parent.createDiv({ cls: "brewin-heatmap" });
    const cols = heatmapCells(habit, today, this.plugin.settings.heatmapWeeks, this.plugin.settings.firstDayOfWeek);
    for (const col of cols) {
      const colEl = wrap.createDiv({ cls: "brewin-heat-col" });
      for (const cell of col) {
        const c = colEl.createDiv({ cls: "brewin-heat-cell" });
        if (cell.date > today) c.addClass("future");
        else if (!cell.due) c.addClass("notdue");
        else if (cell.breach) c.addClass("breach"); // a vice went over — read as bad, not "progress"
        else if (vice) {
          // A vice's good day is an untouched one, so clean days get the full colour (a clean run
          // should look like a streak, not like a gap) and use within an allowance a lighter one.
          c.addClass(cell.ratio > 0 ? "lvl2" : "lvl4");
        } else {
          // shade by ratio: 4 buckets
          const lvl = cell.ratio >= 1 ? 4 : cell.ratio >= 0.66 ? 3 : cell.ratio >= 0.33 ? 2 : cell.ratio > 0 ? 1 : 0;
          c.addClass("lvl" + lvl);
        }
        const state = cell.breach ? " — over the limit" : cell.due && cell.satisfied ? (vice ? " — clean" : " — done") : "";
        // Past cells double as a shortcut into the back-fill dialog for that exact day.
        if (cell.date <= today) {
          c.addClass("brewin-heat-click");
          c.setAttr("role", "button");
          c.setAttr("tabindex", "0");
          c.addEventListener("click", () => this.openLogDay(habit, cell.date));
          c.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              this.openLogDay(habit, cell.date);
            }
          });
          c.setAttr("aria-label", `Edit ${cell.date}${cell.due ? "" : " (not due)"}${state}`);
        } else {
          c.setAttr("aria-label", `${cell.date}${cell.due ? "" : " (not due)"}${state}`);
        }
      }
    }
  }

  private openNote(path: string): void {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) this.app.workspace.getLeaf(false).openFile(f);
  }
}

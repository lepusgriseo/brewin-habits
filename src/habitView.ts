import { ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { currentStreak, heatmapCells, isBreach, isDueOn, isSatisfied, isVice, valueOn } from "./habit";
import { addDays, formatISO, parseISO, todayISO } from "./dates";
import { HabitModal } from "./habitModal";
import { LogDayModal } from "./logDayModal";
import { RewardModal } from "./rewardModal";
import { ConfirmModal } from "./confirmModal";
import { dueUnmetToday, habitBacklogDays, ExternalBacklog } from "./backlog";
import { isBacklogBlocked } from "./rewards";
import type BrewinHabitsPlugin from "./main";
import { Habit, Reward } from "./types";

export const HABIT_VIEW_TYPE = "brewin-habits";

/** Default date for the "log a past day" dialog — the most common thing you forgot. */
function yesterday(): string {
  return formatISO(addDays(parseISO(todayISO())!, -1));
}

export class HabitView extends ItemView {
  /** Session state only — resets to open next time the pane is opened. */
  private rewardsOpen = true;

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
    toolbar.createEl("button", { text: "⟳" }).addEventListener("click", () => this.render());

    const all = this.plugin.habits.getHabits().filter((h) => h.active);

    // Rewards render regardless of whether any habits exist yet — a catalog and a balance can
    // outlive the habits that earned them, and shouldn't disappear along with the last one.
    await this.renderRewards(root, all, today);

    if (!all.length) {
      root.createDiv({ cls: "brewin-empty", text: "No habits yet. Press ＋ New habit." });
      return;
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
  }

  /**
   * Points balance, today's cash-in chance, the reward catalog, and recent history.
   * Collapsible the same way Review's Unscheduled section is (▾/▸ header, session-only state).
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
    head.setAttr("role", "button");
    head.setAttr("tabindex", "0");
    head.setAttr("aria-expanded", String(open));
    head.setAttr("aria-label", open ? "Collapse rewards" : "Expand rewards");
    const toggle = () => {
      this.rewardsOpen = !this.rewardsOpen;
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
      actions.createEl("button", { text: "✎", cls: "brewin-icon-btn" }).addEventListener("click", () => {
        new RewardModal(this.app, this.plugin.rewards, () => this.render(), reward).open();
      });
      actions.createEl("button", { text: "🗑", cls: "brewin-icon-btn" }).addEventListener("click", async () => {
        await this.plugin.rewards.removeReward(reward.name);
        this.render();
      });
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

  /** "Backlog: 3 tasks overdue · 1 fitness session missed · 2 habits behind" — the breakdown
   *  behind the chance/block, so the number moving is never a mystery. */
  private backlogLine(allHabits: Habit[], ext: ExternalBacklog, today: string): string {
    const bits: string[] = [];
    if (ext.tasksOverdue) bits.push(`${ext.tasksOverdue} task${ext.tasksOverdue === 1 ? "" : "s"} overdue`);
    if (ext.tasksSlipped) bits.push(`${ext.tasksSlipped} slipped`);
    if (ext.fitnessMissed) bits.push(`${ext.fitnessMissed} fitness session${ext.fitnessMissed === 1 ? "" : "s"} missed`);
    const habitsBehind = dueUnmetToday(allHabits, today) + habitBacklogDays(allHabits, today, this.plugin.settings.backlogWindowDays);
    if (habitsBehind) bits.push(`${habitsBehind} habit${habitsBehind === 1 ? "" : "s"} behind`);
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
    if (habit.kind === "binary") {
      // A binary vice logs a slip, so the button's meaning flips.
      const logged = valueOn(habit, today) > 0;
      const btn = ctrl.createEl("button", {
        cls: "brewin-habit-check" + (logged ? (vice ? " breach" : " done") : ""),
        text: vice ? (logged ? "✗ Slipped" : "Log a slip") : logged ? "✓ Done" : "Mark done",
      });
      if (!vice) btn.toggleClass("brewin-disabled", !dueToday && !logged);
      btn.addEventListener("click", () => this.markAndReward(habit, "toggle"));
    } else {
      const val = valueOn(habit, today);
      ctrl.createEl("button", { cls: "brewin-habit-step", text: "−" }).addEventListener("click", () => this.markAndReward(habit, "dec"));
      const unit = habit.unit ? " " + habit.unit : "";
      ctrl.createSpan({
        cls: "brewin-habit-count" + (vice && val > habit.target ? " breach" : ""),
        // For a vice the target is a ceiling, so read it as "used / allowed".
        text: vice ? `${val} / ${habit.target} max${unit}` : `${val} / ${habit.target}${unit}`,
      });
      ctrl.createEl("button", { cls: "brewin-habit-step", text: "＋" }).addEventListener("click", () => this.markAndReward(habit, "inc"));
    }

    // Back-fill a past day — the heatmap cells below are also clickable for the same thing.
    const past = ctrl.createEl("button", { cls: "brewin-icon-btn brewin-habit-pastbtn", text: "📅" });
    past.setAttr("aria-label", "Log a past day");
    past.addEventListener("click", () => this.openLogDay(habit, yesterday()));

    // Heatmap
    this.heatmap(card, habit, today);
  }

  /**
   * Mark a habit, then let the rewards store re-check points/perfect-day against the fresh
   * habit list. Kept as one shared path (rather than repeating this at each of the three mark
   * call sites) so the two stores can never drift out of sync with each other.
   */
  private async markAndReward(habit: Habit, action: "toggle" | "inc" | "dec"): Promise<void> {
    const before = habit;
    const today = todayISO();
    await this.plugin.habits.mark(habit, action);
    const allHabits = this.plugin.habits.getHabits();
    const after = allHabits.find((h) => h.path === habit.path) ?? habit;
    await this.plugin.rewards.recordHabitAction(before, after, allHabits, today);
    this.render();
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
    const before = habit;
    await this.plugin.habits.setValue(habit, dateISO, value);
    const allHabits = this.plugin.habits.getHabits();
    const after = allHabits.find((h) => h.path === habit.path) ?? habit;
    await this.plugin.rewards.recordHabitAction(before, after, allHabits, dateISO);
    new Notice(`${habit.title}: ${dateISO} updated.`);
    this.render();
  }

  private heatmap(parent: HTMLElement, habit: Habit, today: string): void {
    const wrap = parent.createDiv({ cls: "brewin-heatmap" });
    const cols = heatmapCells(habit, today, this.plugin.settings.heatmapWeeks, this.plugin.settings.firstDayOfWeek);
    for (const col of cols) {
      const colEl = wrap.createDiv({ cls: "brewin-heat-col" });
      for (const cell of col) {
        const c = colEl.createDiv({ cls: "brewin-heat-cell" });
        if (cell.date > today) c.addClass("future");
        else if (!cell.due) c.addClass("notdue");
        else if (cell.breach) c.addClass("breach"); // a vice went over — read as bad, not "progress"
        else {
          // shade by ratio: 4 buckets
          const lvl = cell.ratio >= 1 ? 4 : cell.ratio >= 0.66 ? 3 : cell.ratio >= 0.33 ? 2 : cell.ratio > 0 ? 1 : 0;
          c.addClass("lvl" + lvl);
        }
        const state = cell.breach ? " — over the limit" : cell.due && cell.satisfied ? " — ok" : "";
        // Past cells double as a shortcut into the back-fill dialog for that exact day.
        if (cell.date <= today) {
          c.addClass("brewin-heat-click");
          c.setAttr("role", "button");
          c.addEventListener("click", () => this.openLogDay(habit, cell.date));
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

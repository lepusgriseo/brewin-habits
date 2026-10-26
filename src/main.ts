import { Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { BrewinHabitsSettings, BrewinHabitsSettingTab, DEFAULT_SETTINGS } from "./settings";
import { HabitStore } from "./habitStore";
import { RewardStore } from "./rewardStore";
import { BacklogStore } from "./backlogStore";
import { HABIT_VIEW_TYPE, HabitView } from "./habitView";
import { HabitModal } from "./habitModal";
import { ANALYTICS_VIEW_TYPE, AnalyticsView } from "./analyticsView";
import { dayHabitReview, formatWeekHabitBlock, HabitDayRow, HabitRangeReview, rangeHabitReview, weekHabitReview } from "./analytics";
import { isoWeekOf, todayISO, weekRange } from "./dates";
import { fillSection, isLiveReview } from "./section";

/** Heading the weekly-review command fills. Must match `_Template/Weekly Review.md`. */
const HABIT_SECTION_HEADING = "### Habits this week";

export default class BrewinHabitsPlugin extends Plugin {
  settings!: BrewinHabitsSettings;
  habits!: HabitStore;
  rewards!: RewardStore;
  backlog!: BacklogStore;
  private refreshQueued = false;

  /**
   * Read-only, for notes: `app.plugins.plugins["brewin-habits"].api.day("2026-10-22")` from
   * dataviewjs — the habits due that day and how each went — and `api.range(from, to)` for a
   * week or month. The day note (`00_Systems/Scripts/Day/view.js`) and the review notes
   * (`00_Systems/Scripts/Review/view.js`) are the callers; `version` lets them notice a change of
   * shape (adding a function, as `range` was in 1.6.0, keeps it).
   */
  readonly api = {
    version: 1,
    day: (iso: string): HabitDayRow[] => dayHabitReview(this.habits.getHabits(), iso, todayISO()),
    range: (fromISO: string, toISO: string): HabitRangeReview => rangeHabitReview(this.habits.getHabits(), fromISO, toISO, todayISO()),
  };

  async onload(): Promise<void> {
    await this.loadSettings();
    this.habits = new HabitStore(this.app, this.settings);
    this.rewards = new RewardStore(this.app, this.settings);
    this.backlog = new BacklogStore(this.app, this.settings);

    this.registerView(HABIT_VIEW_TYPE, (leaf: WorkspaceLeaf) => new HabitView(leaf, this));
    this.registerView(ANALYTICS_VIEW_TYPE, (leaf: WorkspaceLeaf) => new AnalyticsView(leaf, this));

    this.addRibbonIcon("flame", "Brewin: habits", () => this.activateHabits());

    this.addCommand({ id: "brewin-habits-open", name: "Open habits", callback: () => this.activateHabits() });
    this.addCommand({
      id: "brewin-habits-new",
      name: "New habit",
      callback: () => new HabitModal(this.app, this.habits, () => this.refreshViews()).open(),
    });
    this.addCommand({ id: "brewin-habits-open-analytics", name: "Open analytics heatmap", callback: () => this.activateAnalytics() });
    this.addCommand({
      id: "brewin-insert-week-habit-summary",
      name: "Insert this week's habit summary",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const ok = !!file && file.extension === "md";
        if (ok && !checking) void this.insertWeekHabitSummary(file!);
        return ok;
      },
    });

    this.addSettingTab(new BrewinHabitsSettingTab(this.app, this));

    // Redraw when something the views show has changed — a habit note, Rewards.md (both in the
    // habits folder) or a sibling plugin's backlog note — and nothing else. Reacting to every
    // file in the vault redrew both views on each pause in typing anywhere. Our own Habits
    // Backlog.md is skipped too: writing it would re-trigger this listener, recompute, write
    // again, forever.
    const watched = (path: string): boolean =>
      path !== this.backlog.notePath &&
      (path.startsWith(this.settings.habitsFolder + "/") || this.backlog.siblingPaths.includes(path));
    // "changed" means the cache has caught up with a file, so the stores can stop serving the
    // values they just wrote and trust it again.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file: TFile) => {
        this.habits.forget(file.path);
        if (file.path === this.rewards.notePath) this.rewards.forget();
        if (watched(file.path)) this.queueRefresh();
      })
    );
    this.registerEvent(
      this.app.vault.on("create", (file: TAbstractFile) => {
        if (watched(file.path)) this.queueRefresh();
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => {
        this.habits.forget(file.path);
        if (watched(file.path)) this.queueRefresh();
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        this.habits.forget(oldPath);
        if (watched(file.path) || watched(oldPath)) this.queueRefresh();
      })
    );
  }

  onunload(): void {
    // Leaves are cleaned up by Obsidian; nothing else to tear down.
  }

  async activateHabits(): Promise<void> {
    await this.reveal(HABIT_VIEW_TYPE);
  }

  async activateAnalytics(): Promise<void> {
    await this.reveal(ANALYTICS_VIEW_TYPE, true);
  }

  private async reveal(type: string, mainPane = false): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(type)[0];
    if (!leaf) {
      leaf = mainPane ? workspace.getLeaf(true) : workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(HABIT_VIEW_TYPE)) {
      if (leaf.view instanceof HabitView) leaf.view.render();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(ANALYTICS_VIEW_TYPE)) {
      if (leaf.view instanceof AnalyticsView) leaf.view.render();
    }
  }

  private queueRefresh(): void {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    window.setTimeout(() => {
      this.refreshQueued = false;
      void this.backlog.writeOwn(this.habits.getHabits(), todayISO());
      this.refreshViews();
    }, 300);
  }

  /**
   * Which ISO week a review note is about: its `Week:` frontmatter, else a `YYYY-Www` in the
   * filename, else the current ISO week (with a heads-up). Returns the week label and its
   * Mon–Sun bounds, or null when nothing resolves.
   */
  private resolveReviewWeek(file: TFile): { label: string; start: string; end: string } | null {
    const fmWeek = this.app.metadataCache.getFileCache(file)?.frontmatter?.Week;
    const fromFm = fmWeek != null ? weekRange(String(fmWeek)) : null;
    if (fromFm) return { label: String(fmWeek).trim(), ...fromFm };

    const nameLabel = /(\d{4}-W\d{2})/.exec(file.basename)?.[1];
    const fromName = nameLabel ? weekRange(nameLabel) : null;
    if (fromName) return { label: nameLabel!, ...fromName };

    const label = isoWeekOf(todayISO());
    const fromToday = weekRange(label);
    if (fromToday) {
      new Notice(`No Week: frontmatter — using the current ISO week ${label}.`);
      return { label, ...fromToday };
    }
    new Notice("Couldn't work out which week to summarise.");
    return null;
  }

  /** Write a frozen summary of the week's habits (hit / missed / streak) into `file`. */
  async insertWeekHabitSummary(file: TFile): Promise<void> {
    if (isLiveReview(await this.app.vault.read(file))) {
      new Notice("This review shows its habits live — nothing to insert. Its 📌 button freezes the week.");
      return;
    }
    const week = this.resolveReviewWeek(file);
    if (!week) return;
    const review = weekHabitReview(this.habits.getHabits(), week.start, week.end, todayISO());
    const block = formatWeekHabitBlock(review, {
      weekLabel: week.label,
      startISO: week.start,
      endISO: week.end,
      generatedISO: todayISO(),
    });
    await this.app.vault.process(file, (data) => fillSection(data, HABIT_SECTION_HEADING, block));
    new Notice(`Habit summary for ${week.label} inserted.`);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    // Week start, heatmap length and the economy all change what's on screen.
    this.queueRefresh();
  }
}

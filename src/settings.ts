import { App, PluginSettingTab, Setting } from "obsidian";
import type BrewinHabitsPlugin from "./main";

export interface BrewinHabitsSettings {
  habitsFolder: string;
  /** 0 = Sunday, 1 = Monday. */
  firstDayOfWeek: number;
  /** Weeks shown in the habit heatmap. */
  heatmapWeeks: number;

  // ── Habit rewards ──────────────────────────────────────────────────────────
  /** Points earned when a due habit transitions from unsatisfied to satisfied. */
  pointsPerCompletion: number;
  /** Extra points when EVERY habit due today is satisfied. */
  perfectDayBonus: number;
  /** Cash-in success chance (%) with no vices slipped today. */
  rewardBaseChance: number;
  /** Percentage points the chance drops per distinct vice slipped today. */
  rewardChancePenaltyPerVice: number;
  /** The chance never drops below this, however many vices slip. */
  rewardMinChance: number;

  // ── Cross-plugin backlog ───────────────────────────────────────────────────
  /** Where the shared backlog notes (this plugin's own + the sibling Brewin plugins') live. */
  accountabilityFolder: string;
  /** Trailing days considered when counting missed habit due-days for the backlog penalty. */
  backlogWindowDays: number;
  /** Percentage points the cash-in chance drops per backlog item (unmet/missed habits, plus
   *  whatever Brewin Planner/Fitness report) — smaller than the per-vice penalty since backlog
   *  items can be numerous. */
  rewardChancePenaltyPerBacklogItem: number;
  /** Cash-in is refused outright once backlog reaches this many items. 0 disables the hard block. */
  rewardBacklogBlockThreshold: number;
  /** Escape hatch back to today's vice-only chance behaviour. */
  crossPluginBacklogEnabled: boolean;
}

export const DEFAULT_SETTINGS: BrewinHabitsSettings = {
  habitsFolder: "00_Systems/Habits",
  firstDayOfWeek: 1,
  heatmapWeeks: 16,
  pointsPerCompletion: 5,
  perfectDayBonus: 20,
  rewardBaseChance: 90,
  rewardChancePenaltyPerVice: 15,
  rewardMinChance: 10,
  accountabilityFolder: "00_Systems/Accountability",
  backlogWindowDays: 7,
  rewardChancePenaltyPerBacklogItem: 5,
  rewardBacklogBlockThreshold: 10,
  crossPluginBacklogEnabled: true,
};

export class BrewinHabitsSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: BrewinHabitsPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Brewin Habits" });

    new Setting(containerEl)
      .setName("Habits folder")
      .setDesc("Where habit notes (and the Rewards note) live.")
      .addText((t) =>
        t.setValue(this.plugin.settings.habitsFolder).onChange(async (v) => {
          this.plugin.settings.habitsFolder = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("First day of week")
      .setDesc("Used by the heatmap grid alignment.")
      .addDropdown((d) =>
        d
          .addOption("1", "Monday")
          .addOption("0", "Sunday")
          .setValue(String(this.plugin.settings.firstDayOfWeek))
          .onChange(async (v) => {
            this.plugin.settings.firstDayOfWeek = Number(v);
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Habit rewards" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Points build up as habits are completed and spend on cashing in a reward you define " +
        "from the Habits pane. A vice doesn't dock points directly — it lowers the chance a " +
        "cash-in actually succeeds, and that cost is real: points are spent on the attempt " +
        "whether it wins or loses.",
    });

    const rewardNum = (
      name: string,
      desc: string,
      key: keyof BrewinHabitsSettings,
      min: number,
      max: number,
      dflt: number
    ) =>
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((t) =>
          t.setValue(String(this.plugin.settings[key])).onChange(async (v) => {
            const n = Number(v);
            (this.plugin.settings[key] as unknown as number) = Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : dflt;
            await this.plugin.saveSettings();
          })
        );

    rewardNum(
      "Points per habit completion",
      "Awarded when a due habit goes from unsatisfied to satisfied; clawed back if you undo it.",
      "pointsPerCompletion",
      0,
      1000,
      5
    );
    rewardNum(
      "Perfect-day bonus",
      "Extra points when every habit due today is satisfied — build habits done, vices clean.",
      "perfectDayBonus",
      0,
      1000,
      20
    );
    rewardNum("Base cash-in chance (%)", "Success chance for a cash-in attempt with no vices slipped today.", "rewardBaseChance", 1, 100, 90);
    rewardNum(
      "Chance penalty per vice (%)",
      "How many percentage points the chance drops for each distinct vice slipped today.",
      "rewardChancePenaltyPerVice",
      0,
      100,
      15
    );
    rewardNum("Minimum chance (%)", "The chance never drops below this, no matter how many vices slip.", "rewardMinChance", 1, 100, 10);

    containerEl.createEl("h3", { text: "Cross-plugin backlog" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Falling behind elsewhere also docks the cash-in chance: unmet or missed build habits, " +
        "plus whatever Brewin Planner (overdue/slipped tasks) and Brewin Fitness (missed " +
        "sessions) report via their own shared backlog notes.",
    });

    new Setting(containerEl)
      .setName("Enable cross-plugin backlog")
      .setDesc("Turn off to go back to today's vice-only chance, ignoring all backlog.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.crossPluginBacklogEnabled).onChange(async (v) => {
          this.plugin.settings.crossPluginBacklogEnabled = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Accountability folder")
      .setDesc("Where the shared backlog notes (this plugin's own + the sibling plugins') live.")
      .addText((t) =>
        t.setValue(this.plugin.settings.accountabilityFolder).onChange(async (v) => {
          this.plugin.settings.accountabilityFolder = v.trim();
          await this.plugin.saveSettings();
        })
      );

    rewardNum(
      "Backlog window (days)",
      "How many trailing days count toward the missed-habit-days part of the backlog.",
      "backlogWindowDays",
      1,
      90,
      7
    );
    rewardNum(
      "Chance penalty per backlog item (%)",
      "How many percentage points the chance drops per backlog item — kept smaller than the " +
        "vice penalty since there can be several at once.",
      "rewardChancePenaltyPerBacklogItem",
      0,
      100,
      5
    );
    rewardNum(
      "Hard-block threshold",
      "Cash-in is refused outright once backlog reaches this many items. 0 disables the block.",
      "rewardBacklogBlockThreshold",
      0,
      1000,
      10
    );
  }
}

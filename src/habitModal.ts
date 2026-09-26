import { App, Modal, Notice, Setting } from "obsidian";
import { HabitStore } from "./habitStore";
import { HabitKind, HabitPolarity } from "./types";

const CADENCE_PRESETS: Record<string, string> = {
  "Every day": "FREQ=DAILY",
  "Weekdays (Mon–Fri)": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  "Weekly (Mon)": "FREQ=WEEKLY;BYDAY=MO",
  "3× a week (Mon/Wed/Fri)": "FREQ=WEEKLY;BYDAY=MO,WE,FR",
  "Weekly (Sun)": "FREQ=WEEKLY;BYDAY=SU",
};

/** Create-a-habit modal. */
export class HabitModal extends Modal {
  private title = "";
  private cadence = "FREQ=DAILY";
  private kind: HabitKind = "binary";
  private polarity: HabitPolarity = "build";
  private target = 1;
  private unit = "";
  private step = 1;

  constructor(app: App, private store: HabitStore, private onCreated: () => void) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "New habit" });

    const titleInput = contentEl.createEl("input", { type: "text", cls: "brewin-capture-title", placeholder: "Habit name (e.g. Drink water)" });
    titleInput.addEventListener("input", () => (this.title = titleInput.value));
    window.setTimeout(() => titleInput.focus(), 0);

    let renderKind = () => {};

    // Build vs avoid decides what a "good day" means for every other setting below.
    new Setting(contentEl)
      .setName("Track as")
      .setDesc("A habit you want to keep up, or a vice you want to avoid.")
      .addDropdown((d) =>
        d
          .addOption("build", "✅ Habit — do it")
          .addOption("avoid", "🚭 Vice — avoid it")
          .setValue(this.polarity)
          .onChange((v) => {
            this.polarity = v as HabitPolarity;
            // An avoid-target is an allowance, so 0 is the sensible default.
            this.target = this.polarity === "avoid" ? 0 : 1;
            renderKind();
          })
      );

    new Setting(contentEl).setName("Cadence").setDesc("When is it due?").addDropdown((d) => {
      Object.keys(CADENCE_PRESETS).forEach((k) => d.addOption(CADENCE_PRESETS[k], k));
      d.setValue(this.cadence).onChange((v) => (this.cadence = v));
    });

    const countSettings = contentEl.createDiv();

    new Setting(contentEl).setName("Type").addDropdown((d) =>
      d
        .addOption("binary", "Yes / no (did it)")
        .addOption("count", "Count toward a target")
        .setValue(this.kind)
        .onChange((v) => {
          this.kind = v as HabitKind;
          renderKind();
        })
    );

    const targetSetting = new Setting(countSettings);
    const targetInput = targetSetting.controlEl.createEl("input", { type: "number" });
    targetInput.value = String(this.target);
    targetInput.addEventListener("input", () => {
      const n = Number(targetInput.value);
      const min = this.polarity === "avoid" ? 0 : 1; // a vice may allow zero
      this.target = Number.isFinite(n) ? Math.max(min, Math.round(n)) : min;
    });

    new Setting(countSettings).setName("Unit").addText((t) => t.setPlaceholder("ml, g, cigarettes…").onChange((v) => (this.unit = v.trim())));
    new Setting(countSettings).setName("Step per tap").addText((t) =>
      t.setValue(String(this.step)).onChange((v) => (this.step = Math.max(1, Number(v) || 1)))
    );

    renderKind = () => {
      const vice = this.polarity === "avoid";
      // A binary vice still needs its allowance (usually 0), so show the target for it.
      countSettings.toggleClass("brewin-hidden", this.kind !== "count" && !vice);
      targetSetting
        .setName(vice ? "Daily allowance" : "Target")
        .setDesc(vice ? "Most you'll allow per day — 0 means abstain completely." : "Amount per day, e.g. 3000");
      targetInput.value = String(this.target);
    };
    renderKind();

    const btns = contentEl.createDiv({ cls: "brewin-capture-buttons" });
    btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    btns.createEl("button", { text: "Create habit", cls: "mod-cta" }).addEventListener("click", () => this.save());
  }

  private async save(): Promise<void> {
    const title = this.title.trim();
    if (!title) {
      new Notice("Habit needs a name");
      return;
    }
    const vice = this.polarity === "avoid";
    await this.store.createHabit({
      title,
      cadence: this.cadence,
      kind: this.kind,
      polarity: this.polarity,
      // Build-binary always targets 1; a vice's target is its allowance either way.
      target: this.kind === "count" || vice ? this.target : 1,
      unit: this.kind === "count" ? this.unit : "",
      step: this.kind === "count" ? this.step : 1,
    });
    new Notice(`${vice ? "Vice" : "Habit"} created: ${title}`);
    this.onCreated();
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

import { App, Modal } from "obsidian";
import { isVice, valueOn } from "./habit";
import { todayISO } from "./dates";
import { Habit } from "./types";

/**
 * Back-fill one day for a habit — pick a date from the calendar, set the value, save. Used for
 * days you did (or slipped on) something and forgot to record it at the time. Today's value is
 * better handled by the card's own control; this exists for *past* days.
 */
export class LogDayModal extends Modal {
  private date: string;
  private value: number;

  constructor(
    app: App,
    private habit: Habit,
    startDate: string,
    private onSave: (dateISO: string, value: number) => void | Promise<void>
  ) {
    super(app);
    const today = todayISO();
    this.date = !startDate || startDate > today ? today : startDate;
    this.value = valueOn(habit, this.date);
  }

  onOpen(): void {
    const { contentEl } = this;
    const vice = isVice(this.habit);
    contentEl.createEl("h3", { text: `Log a day — ${this.habit.title}` });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: vice
        ? "Record a day you slipped and forgot to log at the time."
        : "Record a day you did this and forgot to tick it at the time.",
    });

    const dateRow = contentEl.createDiv({ cls: "brewin-logday-row" });
    dateRow.createEl("label", { text: "Date" });
    const dateInput = dateRow.createEl("input", { type: "date" });
    dateInput.value = this.date;
    dateInput.max = todayISO();
    if (this.habit.created) dateInput.min = this.habit.created;

    const valRow = contentEl.createDiv({ cls: "brewin-logday-row" });
    const note = contentEl.createDiv({ cls: "brewin-logday-note setting-item-description" });

    const renderValue = () => {
      valRow.empty();
      if (this.habit.kind === "binary") {
        const id = "brewin-logday-cb";
        const cb = valRow.createEl("input", { type: "checkbox", attr: { id } });
        cb.checked = this.value > 0;
        cb.addEventListener("change", () => (this.value = cb.checked ? 1 : 0));
        valRow.createEl("label", { text: vice ? "Slipped that day" : "Did it that day", attr: { for: id } });
      } else {
        valRow.createEl("label", { text: "Amount" });
        const num = valRow.createEl("input", { type: "number", attr: { min: "0", step: String(this.habit.step || 1) } });
        num.value = String(this.value || 0);
        num.addEventListener("input", () => {
          const n = Number(num.value);
          this.value = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
        });
        if (this.habit.unit) valRow.createSpan({ cls: "brewin-logday-unit", text: this.habit.unit });
      }
    };

    const renderNote = () => {
      note.empty();
      if (this.habit.created && this.date < this.habit.created) {
        note.setText(`Note: this is before the habit's start date (${this.habit.created}) — it won't count toward streaks.`);
      }
    };

    dateInput.addEventListener("change", () => {
      this.date = dateInput.value || this.date;
      this.value = valueOn(this.habit, this.date);
      renderValue();
      renderNote();
    });

    renderValue();
    renderNote();

    const btns = contentEl.createDiv({ cls: "brewin-capture-buttons" });
    btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    btns.createEl("button", { text: "Save", cls: "mod-cta" }).addEventListener("click", async () => {
      await this.onSave(this.date, this.value);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

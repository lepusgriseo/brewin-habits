import { App, Modal, Notice, Setting } from "obsidian";
import { RewardStore } from "./rewardStore";
import { Reward } from "./types";

/** Add or edit one catalog entry — name + point cost. Mirrors HabitModal's minimal shape. */
export class RewardModal extends Modal {
  private name: string;
  private cost: number;

  constructor(app: App, private store: RewardStore, private onSaved: () => void, private existing?: Reward) {
    super(app);
    this.name = existing?.name ?? "";
    this.cost = existing?.cost ?? 25;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.existing ? "Edit reward" : "New reward" });

    const nameInput = contentEl.createEl("input", {
      type: "text",
      cls: "brewin-capture-title",
      placeholder: "Reward (e.g. Watch a movie)",
    });
    nameInput.value = this.name;
    nameInput.addEventListener("input", () => (this.name = nameInput.value));
    window.setTimeout(() => nameInput.focus(), 0);

    new Setting(contentEl)
      .setName("Cost")
      .setDesc("Points needed to attempt cashing this in.")
      .addText((t) =>
        t.setValue(String(this.cost)).onChange((v) => {
          const n = Number(v);
          this.cost = Number.isFinite(n) && n >= 1 ? Math.round(n) : 1;
        })
      );

    const btns = contentEl.createDiv({ cls: "brewin-capture-buttons" });
    btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    btns.createEl("button", { text: this.existing ? "Save" : "Add reward", cls: "mod-cta" }).addEventListener("click", () => this.save());
  }

  private async save(): Promise<void> {
    const name = this.name.trim();
    if (!name) {
      new Notice("Reward needs a name");
      return;
    }
    if (this.existing) await this.store.editReward(this.existing.name, name, this.cost);
    else await this.store.addReward(name, this.cost);
    new Notice(`Reward ${this.existing ? "updated" : "added"}: ${name}`);
    this.onSaved();
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

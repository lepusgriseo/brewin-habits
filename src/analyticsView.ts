import { ItemView, WorkspaceLeaf } from "obsidian";
import { addDays, formatISO, parseISO, todayISO } from "./dates";
import { dailyScores, heatLevel, heatStats, toWeekColumns } from "./analytics";
import { isVice } from "./habit";
import type BrewinHabitsPlugin from "./main";

export const ANALYTICS_VIEW_TYPE = "brewin-analytics";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A year of consistency at a glance — one heatmap, nothing else competing with it. */
export class AnalyticsView extends ItemView {
  /** "" = every habit combined; otherwise a single habit's path. */
  private focus = "";

  constructor(leaf: WorkspaceLeaf, private plugin: BrewinHabitsPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return ANALYTICS_VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Analytics";
  }
  getIcon(): string {
    return "bar-chart";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("brewin-analytics");

    const today = todayISO();
    const all = this.plugin.habits.getHabits();
    // A rolling year ending today, aligned so the grid starts on a week boundary.
    const start = formatISO(addDays(parseISO(today)!, -363));

    // ── Toolbar: which habit(s) to show ──
    const bar = root.createDiv({ cls: "brewin-toolbar" });
    const sel = bar.createEl("select", { cls: "brewin-context-filter" });
    sel.createEl("option", { text: "All habits", value: "" });
    all.forEach((h) => sel.createEl("option", { text: (isVice(h) ? "🚭 " : "") + h.title, value: h.path }));
    sel.value = this.focus;
    sel.addEventListener("change", () => {
      this.focus = sel.value;
      this.render();
    });
    bar.createEl("button", { text: "⟳" }).addEventListener("click", () => this.render());

    if (!all.length) {
      root.createDiv({ cls: "brewin-empty", text: "No habits yet — the heatmap fills in as you track them." });
      return;
    }

    const habits = this.focus ? all.filter((h) => h.path === this.focus) : all;
    const scores = dailyScores(habits, start, today, today);
    const cols = toWeekColumns(scores, this.plugin.settings.firstDayOfWeek);

    // ── Month labels, aligned to the week column each month starts in ──
    const grid = root.createDiv({ cls: "brewin-hm" });
    const monthRow = grid.createDiv({ cls: "brewin-hm-months" });
    let lastMonth = -1;
    cols.forEach((col) => {
      const firstReal = col.find((c) => c !== null);
      const label = monthRow.createDiv({ cls: "brewin-hm-month" });
      if (firstReal) {
        const m = parseISO(firstReal.date)!.getUTCMonth();
        if (m !== lastMonth) {
          label.setText(MONTHS[m]);
          lastMonth = m;
        }
      }
    });

    // ── The heatmap ──
    const body = grid.createDiv({ cls: "brewin-hm-body" });
    for (const col of cols) {
      const colEl = body.createDiv({ cls: "brewin-hm-col" });
      for (const cell of col) {
        const c = colEl.createDiv({ cls: "brewin-hm-cell" });
        if (!cell) {
          c.addClass("pad");
          continue;
        }
        if (cell.future) c.addClass("future");
        else if (cell.breach) c.addClass("breach");
        else {
          const lvl = heatLevel(cell);
          c.addClass(lvl < 0 ? "empty" : "lvl" + lvl);
        }
        c.setAttr(
          "aria-label",
          cell.ratio === null
            ? `${cell.date} — nothing due`
            : `${cell.date} — ${cell.done}/${cell.due} done${cell.breach ? ", a vice went over" : ""}`
        );
      }
    }

    // ── Legend + the few numbers that make the colours readable ──
    const legend = root.createDiv({ cls: "brewin-hm-legend" });
    legend.createSpan({ text: "Less" });
    [0, 1, 2, 3, 4].forEach((l) => legend.createSpan({ cls: `brewin-hm-cell lvl${l}` }));
    legend.createSpan({ text: "More" });
    const breachKey = legend.createSpan({ cls: "brewin-hm-legend-item" });
    breachKey.createSpan({ cls: "brewin-hm-cell breach" });
    breachKey.createSpan({ text: "vice over limit" });

    const s = heatStats(scores);
    root.createDiv({
      cls: "brewin-hm-stats",
      text:
        `${s.perfectDays}/${s.activeDays} full days · best run ${s.bestStreak}` +
        (s.breaches ? ` · ${s.breaches} slip${s.breaches === 1 ? "" : "s"}` : ""),
    });
  }
}

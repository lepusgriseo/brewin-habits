import { App, normalizePath, TFile, TFolder } from "obsidian";
import { BrewinHabitsSettings } from "./settings";
import { Habit } from "./types";
import { dueUnmetToday, habitBacklogDays, ExternalBacklog } from "./backlog";

const OWN_FILE = "Habits Backlog.md";
const TASKS_FILE = "Tasks Backlog.md";
const FITNESS_FILE = "Fitness Backlog.md";

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

/**
 * Reads/writes the shared cross-plugin backlog notes under `accountabilityFolder`. Habits OWNS
 * `Habits Backlog.md` — only this store ever writes it — and READS the sibling notes the other
 * two Brewin plugins own. Same "state lives in a note" idiom as Rewards.md, just one note per
 * producing plugin instead of one shared note, so there's no cross-plugin write race.
 */
export class BacklogStore {
  constructor(private app: App, private settings: BrewinHabitsSettings) {}

  private path(name: string): string {
    return normalizePath(`${this.settings.accountabilityFolder}/${name}`);
  }

  /** The note this plugin owns — exposed so main.ts's vault-change listeners can ignore our own
   *  writes and avoid re-triggering themselves. */
  get notePath(): string {
    return this.path(OWN_FILE);
  }

  private async ensureFolder(): Promise<void> {
    const norm = normalizePath(this.settings.accountabilityFolder);
    if (this.app.vault.getAbstractFileByPath(norm) instanceof TFolder) return;
    if (this.app.vault.getAbstractFileByPath(norm)) return;
    try {
      await this.app.vault.createFolder(norm);
    } catch {
      /* already exists / race */
    }
  }

  private async ensureFile(): Promise<TFile> {
    const existing = this.app.vault.getAbstractFileByPath(this.notePath);
    if (existing instanceof TFile) return existing;
    await this.ensureFolder();
    const lines = [
      "---",
      "due_unmet_count: 0",
      "backlog_days: 0",
      "generated:",
      "---",
      "",
      "# Habits Backlog",
      "",
      "Written automatically by Brewin Habits. Read by Brewin Planner's digest and by Brewin " +
        "Habits' own cash-in gate — don't hand-edit, it'll just be overwritten on the next refresh.",
      "",
    ];
    return this.app.vault.create(this.notePath, lines.join("\n"));
  }

  /**
   * Recompute and write our own backlog — but only if something actually changed, so an
   * unchanged recompute never produces a redundant `changed` event on our own file (which would
   * otherwise re-trigger the vault-change listener that calls this in the first place).
   */
  async writeOwn(habits: Habit[], dateISO: string): Promise<void> {
    const dueUnmet = dueUnmetToday(habits, dateISO);
    const backlogDays = habitBacklogDays(habits, dateISO, this.settings.backlogWindowDays);
    const file = await this.ensureFile();
    const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
    if (num(fm.due_unmet_count) === dueUnmet && num(fm.backlog_days) === backlogDays) return;
    await this.app.fileManager.processFrontMatter(file, (f) => {
      f.due_unmet_count = dueUnmet;
      f.backlog_days = backlogDays;
      f.generated = new Date().toISOString();
    });
  }

  private readNote(name: string): Record<string, unknown> {
    const file = this.app.vault.getAbstractFileByPath(this.path(name));
    if (!(file instanceof TFile)) return {};
    return (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
  }

  /** Everything the sibling plugins report. All-zero if a sibling hasn't written yet or isn't
   *  installed — never an error. Synchronous: frontmatter reads come straight from the already-
   *  indexed metadata cache, no vault I/O needed. */
  readExternal(): ExternalBacklog {
    const tasks = this.readNote(TASKS_FILE);
    const fitness = this.readNote(FITNESS_FILE);
    return {
      tasksOverdue: num(tasks.overdue_count),
      tasksSlipped: num(tasks.slipped_count),
      fitnessMissed: num(fitness.missed_sessions_count),
    };
  }
}

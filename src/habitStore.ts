import { App, normalizePath, TFile, TFolder } from "obsidian";
import { BrewinHabitsSettings } from "./settings";
import { habitFromFrontmatter, HABIT_TAG, withMarked, withValue } from "./habit";
import { todayISO } from "./dates";
import { Habit, HabitKind, HabitPolarity } from "./types";

export interface NewHabitFields {
  title: string;
  cadence: string;
  kind: HabitKind;
  polarity: HabitPolarity;
  target: number;
  unit: string;
  step: number;
}

/** What one write changed: the habit as the file had it just before, and just after. */
export interface HabitChange {
  before: Habit;
  after: Habit;
}

export class HabitStore {
  /**
   * Values this store has just written, keyed by path. Obsidian's metadata cache re-indexes a file
   * some time AFTER a write resolves, so a read straight after a tap would still see the old log —
   * which is how taps once earned no points and a quick second ＋ overwrote the first. Reads apply
   * these until the cache reports the file changed (`forget`), at which point the cache is current.
   */
  private written = new Map<string, Partial<Pick<Habit, "log" | "active">>>();

  constructor(private app: App, private settings: BrewinHabitsSettings) {}

  getHabits(): Habit[] {
    const folder = this.settings.habitsFolder;
    const out: Habit[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!(file.path.startsWith(folder + "/") || file.path === folder)) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
      const tags = tagList(fm, cache);
      if (!tags.includes(HABIT_TAG)) continue;
      const habit = habitFromFrontmatter(fm, file.path, file.basename);
      out.push({ ...habit, ...this.written.get(file.path) });
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  /** The metadata cache has caught up with `path` (or it was deleted/renamed) — trust it again. */
  forget(path: string): void {
    this.written.delete(path);
  }

  getByPath(path: string): Habit | null {
    return this.getHabits().find((h) => h.path === path) ?? null;
  }

  private async ensureFolder(path: string): Promise<void> {
    const norm = normalizePath(path);
    if (this.app.vault.getAbstractFileByPath(norm) instanceof TFolder) return;
    if (this.app.vault.getAbstractFileByPath(norm)) return;
    try {
      await this.app.vault.createFolder(norm);
    } catch {
      /* ignore */
    }
  }

  private uniquePath(folder: string, title: string): string {
    const safe = title.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "Habit";
    let p = normalizePath(`${folder}/${safe}.md`);
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(p)) p = normalizePath(`${folder}/${safe} ${n++}.md`);
    return p;
  }

  async createHabit(f: NewHabitFields): Promise<TFile> {
    await this.ensureFolder(this.settings.habitsFolder);
    const path = this.uniquePath(this.settings.habitsFolder, f.title);
    const today = todayISO();
    const lines = [
      "---",
      'up: "[[Habits]]"',
      "tags:",
      `  - ${HABIT_TAG}`,
      `cadence: "${f.cadence}"`,
      `kind: ${f.kind}`,
      `polarity: ${f.polarity}`,
    ];
    if (f.kind === "count") {
      lines.push(`target: ${f.target}`, `unit: ${f.unit}`, `step: ${f.step}`);
    } else if (f.polarity === "avoid") {
      lines.push(`target: ${f.target}`); // a binary vice's allowance (normally 0)
    }
    lines.push("log:", "active: true", `created: ${today}`, `modified: ${today}`, "---", "", `# ${f.title}`, "");
    return this.app.vault.create(path, lines.join("\n"));
  }

  private fileFor(habit: Habit): TFile | null {
    const f = this.app.vault.getAbstractFileByPath(habit.path);
    return f instanceof TFile ? f : null;
  }

  /**
   * Read-modify-write one habit's log against the FILE's current frontmatter, inside the same
   * `processFrontMatter` call that writes it — never against a possibly-stale cached copy. Returns
   * the habit as it was before and after, for the reward engine to settle.
   */
  private async applyLog(habit: Habit, change: (current: Habit) => Record<string, number>): Promise<HabitChange | null> {
    const file = this.fileFor(habit);
    if (!file) return null;
    let result = null as HabitChange | null;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const before = habitFromFrontmatter(fm as Record<string, unknown>, file.path, file.basename);
      const log = change(before);
      // Write a plain sorted object so the YAML stays tidy.
      const sorted: Record<string, number> = {};
      for (const k of Object.keys(log).sort()) sorted[k] = log[k];
      fm.log = sorted;
      fm.modified = todayISO();
      result = { before, after: { ...before, log: sorted } };
    });
    if (result) this.written.set(file.path, { ...this.written.get(file.path), log: result.after.log });
    return result;
  }

  async mark(habit: Habit, action: "toggle" | "inc" | "dec" | "clear", dateISO = todayISO()): Promise<HabitChange | null> {
    return this.applyLog(habit, (current) => withMarked(current, dateISO, action));
  }

  /** Set an absolute value for one day (back-filling a forgotten day). */
  async setValue(habit: Habit, dateISO: string, value: number): Promise<HabitChange | null> {
    return this.applyLog(habit, (current) => withValue(current, dateISO, value));
  }

  async setActive(habit: Habit, active: boolean): Promise<void> {
    const file = this.fileFor(habit);
    if (!file) return;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.active = active;
      fm.modified = todayISO();
    });
    this.written.set(file.path, { ...this.written.get(file.path), active });
  }
}

function tagList(fm: Record<string, unknown>, cache: ReturnType<App["metadataCache"]["getFileCache"]>): string[] {
  const tags = new Set<string>();
  const t = fm.tags;
  if (Array.isArray(t)) t.forEach((x) => tags.add(String(x).replace(/^#/, "")));
  else if (typeof t === "string") tags.add(t.replace(/^#/, ""));
  cache?.tags?.forEach((x) => tags.add(x.tag.replace(/^#/, "")));
  return [...tags];
}

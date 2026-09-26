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

export class HabitStore {
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
      out.push(habitFromFrontmatter(fm, file.path, file.basename));
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
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

  private async persistLog(habit: Habit, log: Record<string, number>): Promise<void> {
    const file = this.fileFor(habit);
    if (!file) return;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      // Write a plain sorted object so the YAML stays tidy.
      const sorted: Record<string, number> = {};
      for (const k of Object.keys(log).sort()) sorted[k] = log[k];
      fm.log = sorted;
      fm.modified = todayISO();
    });
  }

  async mark(habit: Habit, action: "toggle" | "inc" | "dec" | "clear", dateISO = todayISO()): Promise<void> {
    await this.persistLog(habit, withMarked(habit, dateISO, action));
  }

  /** Set an absolute value for one day (back-filling a forgotten day). */
  async setValue(habit: Habit, dateISO: string, value: number): Promise<void> {
    await this.persistLog(habit, withValue(habit, dateISO, value));
  }

  async setActive(habit: Habit, active: boolean): Promise<void> {
    const file = this.fileFor(habit);
    if (!file) return;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.active = active;
      fm.modified = todayISO();
    });
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

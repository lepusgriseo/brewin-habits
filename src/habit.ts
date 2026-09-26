// Pure habit logic + frontmatter mapping. No Obsidian imports → unit-testable.
// A habit is a recurring behaviour with a per-day completion log; consistency
// (streaks, heatmap) is what matters, not a due/deadline.

import { addDays, coerceISO, formatISO, parseISO } from "./dates";
import { occursOnISO } from "./rrule";
import { Habit, HabitKind, HabitPolarity } from "./types";

export const HABIT_TAG = "habit";

function asKind(v: unknown): HabitKind {
  return String(v ?? "binary").toLowerCase() === "count" ? "count" : "binary";
}
function num(v: unknown, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function asLog(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const iso = coerceISO(k);
      if (!iso) continue;
      const n = Number(val);
      out[iso] = Number.isFinite(n) ? n : (val ? 1 : 0);
    }
  }
  return out;
}

function asPolarity(v: unknown): HabitPolarity {
  return String(v ?? "build").toLowerCase() === "avoid" ? "avoid" : "build";
}

export function habitFromFrontmatter(fm: Record<string, unknown>, path: string, basename: string): Habit {
  const kind = asKind(fm.kind);
  const polarity = asPolarity(fm.polarity);
  const title = typeof fm.title === "string" && fm.title.trim() ? fm.title.trim() : basename;
  return {
    path,
    title,
    cadence: fm.cadence ? String(fm.cadence) : "FREQ=DAILY",
    kind,
    polarity,
    // A binary vice allows 0 (any occurrence is a slip); a binary habit needs 1.
    target:
      kind === "binary"
        ? polarity === "avoid"
          ? Math.max(0, num(fm.target, 0))
          : 1
        : Math.max(polarity === "avoid" ? 0 : 1, num(fm.target, polarity === "avoid" ? 0 : 1)),
    unit: fm.unit ? String(fm.unit) : "",
    step: Math.max(1, num(fm.step, 1)),
    log: asLog(fm.log),
    active: fm.active === undefined ? true : Boolean(fm.active),
    created: coerceISO(fm.created),
    modified: coerceISO(fm.modified),
  };
}

/** Value logged on a date (0 if none). */
export function valueOn(habit: Habit, dateISO: string): number {
  return habit.log[dateISO] ?? 0;
}

export function isVice(habit: Habit): boolean {
  return habit.polarity === "avoid";
}

/**
 * Was the day a success? For a habit that means reaching the target; for a vice it means
 * staying at or under the allowed maximum (so an untouched day is already a win).
 */
export function isSatisfied(habit: Habit, dateISO: string): boolean {
  const v = valueOn(habit, dateISO);
  return isVice(habit) ? v <= habit.target : v >= habit.target;
}

/** Did a vice exceed its allowance on this date? Always false for a normal habit. */
export function isBreach(habit: Habit, dateISO: string): boolean {
  return isVice(habit) && valueOn(habit, dateISO) > habit.target;
}

/**
 * Progress toward the day's goal, 0–1. For a vice this is "allowance used", so 1 means
 * you're at the limit and anything above it is a breach.
 */
export function ratioOn(habit: Habit, dateISO: string): number {
  const v = valueOn(habit, dateISO);
  if (isVice(habit)) {
    if (habit.target <= 0) return v > 0 ? 1 : 0; // abstinence: any use is "full"
    return Math.max(0, Math.min(1, v / habit.target));
  }
  if (habit.target <= 0) return 0;
  return Math.max(0, Math.min(1, v / habit.target));
}

/** Is the habit scheduled (due) on `dateISO` per its cadence? */
export function isDueOn(habit: Habit, dateISO: string): boolean {
  return occursOnISO(habit.cadence, habit.created, dateISO);
}

/**
 * Current streak = consecutive **due-days** ending at the most recent one that are satisfied.
 * Today counts as "still pending" — an unsatisfied today does not break the streak; we look
 * back from yesterday in that case.
 */
export function currentStreak(habit: Habit, todayISO: string): number {
  let streak = 0;
  let cursor = parseISO(todayISO);
  if (!cursor) return 0;
  let guard = 0;
  const MAX = 366 * 5;
  while (guard < MAX) {
    const iso = formatISO(cursor);
    if (isDueOn(habit, iso)) {
      if (isSatisfied(habit, iso)) {
        streak++;
      } else if (iso === todayISO) {
        // pending today — skip without breaking
      } else {
        break;
      }
    }
    cursor = addDays(cursor, -1);
    guard++;
  }
  return streak;
}

/** Heatmap cells for the last `weeks` weeks up to `todayISO` (oldest → newest), week-aligned. */
export interface HeatCell {
  date: string;
  due: boolean;
  ratio: number; // 0..1
  satisfied: boolean;
  /** A vice went over its allowance on this day. */
  breach: boolean;
}

export function heatmapCells(habit: Habit, todayISO: string, weeks: number, weekStart: number): HeatCell[][] {
  const today = parseISO(todayISO)!;
  // Find the start of the current week, then go back (weeks-1) weeks.
  const dow = today.getUTCDay(); // 0=Sun..6=Sat
  const backToWeekStart = (dow - weekStart + 7) % 7;
  const curWeekStart = addDays(today, -backToWeekStart);
  const gridStart = addDays(curWeekStart, -(weeks - 1) * 7);

  const cols: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const cell = addDays(gridStart, w * 7 + d);
      const iso = formatISO(cell);
      col.push({
        date: iso,
        due: isDueOn(habit, iso),
        ratio: ratioOn(habit, iso),
        satisfied: isSatisfied(habit, iso),
        breach: isBreach(habit, iso),
      });
    }
    cols.push(col);
  }
  return cols;
}

/** Apply a completion action, returning a new log (does not mutate). */
export function withMarked(habit: Habit, dateISO: string, action: "toggle" | "inc" | "dec" | "clear"): Record<string, number> {
  const log = { ...habit.log };
  const cur = log[dateISO] ?? 0;
  // A binary vice logs a slip: 1 = it happened. Same mechanic, opposite meaning.
  if (habit.kind === "binary") {
    if (action === "clear" || (action === "toggle" && cur >= 1)) delete log[dateISO];
    else log[dateISO] = 1;
    return log;
  }
  // count
  if (action === "clear") {
    delete log[dateISO];
  } else if (action === "dec") {
    const next = cur - habit.step;
    if (next <= 0) delete log[dateISO];
    else log[dateISO] = next;
  } else {
    // inc or toggle → add a step (toggle behaves as inc for counts)
    log[dateISO] = cur + habit.step;
  }
  return log;
}

/**
 * Set an ABSOLUTE logged value for one day, returning a new log — the back-fill path for a day
 * you forgot to record. A binary habit stores 1 for "yes" (any positive input) and drops the
 * entry for 0; a count stores the floored value and drops it at 0. Never mutates.
 */
export function withValue(habit: Habit, dateISO: string, value: number): Record<string, number> {
  const log = { ...habit.log };
  const v = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  if (v <= 0) delete log[dateISO];
  else log[dateISO] = habit.kind === "binary" ? 1 : v;
  return log;
}

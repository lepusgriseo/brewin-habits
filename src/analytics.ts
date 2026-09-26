// Pure analytics for the heatmap dashboard. No Obsidian imports → unit-testable.

import { addDays, formatISO, parseISO, shortDate } from "./dates";
import { currentStreak, isBreach, isDueOn, isSatisfied, isVice } from "./habit";
import { Habit } from "./types";

export interface DayScore {
  date: string;
  /** Habits due that day. 0 means nothing was scheduled. */
  due: number;
  /** How many of them were satisfied. */
  done: number;
  /** done/due, or null when nothing was due (an empty day, not a failed one). */
  ratio: number | null;
  /** A vice went over its allowance that day. */
  breach: boolean;
  future: boolean;
}

/**
 * Daily completion across a set of habits — the aggregate the heatmap shades.
 *
 * Days with nothing due score `null` rather than 0, so rest days don't read as failures.
 */
export function dailyScores(habits: Habit[], fromISO: string, toISO: string, todayISO: string): DayScore[] {
  const from = parseISO(fromISO);
  const to = parseISO(toISO);
  if (!from || !to || from > to) return [];

  const out: DayScore[] = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 800) {
    const iso = formatISO(cursor);
    let due = 0;
    let done = 0;
    let breach = false;
    for (const h of habits) {
      if (!h.active) continue;
      if (!isDueOn(h, iso)) continue;
      due++;
      if (isSatisfied(h, iso)) done++;
      if (isBreach(h, iso)) breach = true;
    }
    out.push({
      date: iso,
      due,
      done,
      ratio: due > 0 ? done / due : null,
      breach,
      future: iso > todayISO,
    });
    cursor = addDays(cursor, 1);
    guard++;
  }
  return out;
}

/** Shade bucket 0–4 for a score, or -1 when there's nothing to shade. */
export function heatLevel(score: DayScore): number {
  if (score.future || score.ratio === null) return -1;
  const r = score.ratio;
  if (r >= 1) return 4;
  if (r >= 0.66) return 3;
  if (r >= 0.33) return 2;
  if (r > 0) return 1;
  return 0;
}

export interface HeatStats {
  /** Days where everything due was satisfied. */
  perfectDays: number;
  /** Days that had anything due (the denominator). */
  activeDays: number;
  /** Longest run of consecutive perfect days. */
  bestStreak: number;
  /** Days a vice went over. */
  breaches: number;
}

export function heatStats(scores: DayScore[]): HeatStats {
  let perfectDays = 0;
  let activeDays = 0;
  let bestStreak = 0;
  let run = 0;
  let breaches = 0;

  for (const s of scores) {
    if (s.future) continue;
    if (s.breach) breaches++;
    if (s.ratio === null) continue; // nothing due — neither breaks nor extends a run
    activeDays++;
    if (s.ratio >= 1) {
      perfectDays++;
      run++;
      if (run > bestStreak) bestStreak = run;
    } else {
      run = 0;
    }
  }
  return { perfectDays, activeDays, bestStreak, breaches };
}

// ── Weekly-review snapshot ───────────────────────────────────────────────────
//
// Per-habit + aggregate account of one ISO week, for the weekly-review note. The aggregate
// side reuses `dailyScores` / `heatStats` (already the week engine); the per-habit side walks
// the same days applying `isDueOn` / `isSatisfied` / `isBreach`.

export interface HabitWeekRow {
  habit: Habit;
  /** Due-days this week (per the habit's cadence, from its `created` date on). */
  due: number;
  /** Past due-days (plus today, if already satisfied) that were satisfied. Vice → clean days. */
  hit: number;
  /** Past due-days that were not satisfied. Vice → over-allowance days. */
  missed: number;
  /** Due-days a vice went over its allowance (0 for a normal habit). */
  slips: number;
  /** Due-days still ahead this week, or today not yet satisfied — no verdict. */
  pending: number;
  /** `currentStreak(habit, todayISO)` — consecutive satisfied due-days as of now. */
  streak: number;
}

export interface WeekHabitReview {
  perHabit: HabitWeekRow[];
  totals: HeatStats;
  /** The range's per-day scores, kept for callers that want the raw days. */
  scores: DayScore[];
}

/**
 * Bucket one ISO week's habits. `todayISO` is the fence between "missed" (a past due-day that
 * wasn't satisfied) and "pending" (today-not-yet / future — no verdict). Habits not scheduled
 * at all this week are dropped.
 */
export function weekHabitReview(
  habits: Habit[],
  fromISO: string,
  toISO: string,
  todayISO: string
): WeekHabitReview {
  const scores = dailyScores(habits, fromISO, toISO, todayISO);
  const totals = heatStats(scores);
  const days = scores.map((s) => s.date);

  const perHabit: HabitWeekRow[] = [];
  for (const h of habits) {
    if (!h.active) continue;
    let due = 0;
    let hit = 0;
    let missed = 0;
    let slips = 0;
    let pending = 0;
    for (const iso of days) {
      if (!isDueOn(h, iso)) continue;
      due++;
      if (isBreach(h, iso)) slips++;
      if (iso > todayISO) pending++;
      else if (iso === todayISO) isSatisfied(h, iso) ? hit++ : pending++;
      else isSatisfied(h, iso) ? hit++ : missed++;
    }
    if (!due) continue;
    perHabit.push({ habit: h, due, hit, missed, slips, pending, streak: currentStreak(h, todayISO) });
  }
  perHabit.sort((a, b) => a.habit.title.localeCompare(b.habit.title));

  return { perHabit, totals, scores };
}

/**
 * The markdown that goes under `### Habits this week` in the review note — a per-habit table
 * plus a one-line aggregate. Returns the body only; the heading is owned by `fillSection`.
 */
export function formatWeekHabitBlock(
  r: WeekHabitReview,
  m: { weekLabel: string; startISO: string; endISO: string; generatedISO: string }
): string {
  const lines: string[] = [
    `*${m.weekLabel} · ${shortDate(m.startISO)} – ${shortDate(m.endISO)} · generated ${m.generatedISO}*`,
  ];

  if (!r.perHabit.length) {
    lines.push("", "_No active habits for this week._");
    return lines.join("\n");
  }

  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  lines.push("", "| Habit | Hit | Missed | Streak |", "| --- | --- | --- | --- |");
  for (const row of r.perHabit) {
    const vice = isVice(row.habit);
    const name = vice ? `${row.habit.title} (avoid)` : row.habit.title;
    const hit = vice ? `${row.hit} clean` : String(row.hit);
    const missed = vice ? plural(row.slips, "slip") : String(row.missed);
    lines.push(`| ${name} | ${hit} | ${missed} | ${row.streak} |`);
  }

  const t = r.totals;
  let summary = `**${t.perfectDays} / ${t.activeDays} full days · best run ${t.bestStreak}`;
  if (t.breaches > 0) summary += ` · ${plural(t.breaches, "slip")} this week`;
  lines.push("", summary + "**");

  if (r.perHabit.some((row) => row.pending > 0)) {
    lines.push("", "_Some days this week are still pending._");
  }

  return lines.join("\n");
}

/** Split a flat day list into week columns starting on `weekStart` (0=Sun, 1=Mon). */
export function toWeekColumns(scores: DayScore[], weekStart: number): (DayScore | null)[][] {
  if (!scores.length) return [];
  const cols: (DayScore | null)[][] = [];
  let col: (DayScore | null)[] = [];

  // Pad the first column so each row is a consistent weekday.
  const first = parseISO(scores[0].date)!;
  const lead = (first.getUTCDay() - weekStart + 7) % 7;
  for (let i = 0; i < lead; i++) col.push(null);

  for (const s of scores) {
    col.push(s);
    if (col.length === 7) {
      cols.push(col);
      col = [];
    }
  }
  if (col.length) {
    while (col.length < 7) col.push(null);
    cols.push(col);
  }
  return cols;
}

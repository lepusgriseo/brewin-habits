// Pure cross-plugin backlog logic. No Obsidian imports → unit-testable.
//
// Backlog here is scoped to BUILD habits — vices already have their own penalty via
// vicesSlippedOn in rewards.ts, and this module deliberately never touches vices, so the two
// penalties can't double-count the same slip.
//
// What counts as "behind" (and so docks the cash-in chance, can block it, and feeds Brewin
// Planner's digest) is `habitsBehind`: how many DIFFERENT build habits missed at least one due-day
// in the trailing window, today excluded. Two deliberate limits:
//  - Today never counts. A habit due today and not done yet is still open, not lost — counting it
//    made every morning look like a backlog before the day had started.
//  - Each habit counts once, however many days it missed — the same "how many different, not how
//    much of one" rule vicesSlippedOn uses. Counting every missed day separately let one neglected
//    habit (7 days × 1) outweigh everything else and pinned the cash-in block on for weeks.
//
// `dueUnmetToday` and `habitBacklogDays` remain as information (written to the backlog note) but
// are no longer part of the penalty.

import { addDays, formatISO, parseISO } from "./dates";
import { isDueOn, isSatisfied, isVice } from "./habit";
import { Habit } from "./types";

/** Active BUILD habits due today but not yet satisfied. */
export function dueUnmetToday(habits: Habit[], dateISO: string): number {
  return habits.filter((h) => h.active && !isVice(h) && isDueOn(h, dateISO) && !isSatisfied(h, dateISO)).length;
}

/**
 * Missed due-days for active BUILD habits over the trailing `windowDays`, strictly before
 * `dateISO` (today is excluded — dueUnmetToday covers it instead).
 */
export function habitBacklogDays(habits: Habit[], dateISO: string, windowDays: number): number {
  const today = parseISO(dateISO);
  if (!today || windowDays <= 0) return 0;
  const build = habits.filter((h) => h.active && !isVice(h));
  if (!build.length) return 0;
  let missed = 0;
  for (let i = 1; i <= windowDays; i++) {
    const iso = formatISO(addDays(today, -i));
    for (const h of build) {
      if (isDueOn(h, iso) && !isSatisfied(h, iso)) missed++;
    }
  }
  return missed;
}

/**
 * How many DIFFERENT active build habits missed at least one due-day in the trailing `windowDays`,
 * strictly before `dateISO`. This is the habits part of the backlog penalty.
 */
export function habitsBehind(habits: Habit[], dateISO: string, windowDays: number): number {
  const today = parseISO(dateISO);
  if (!today || windowDays <= 0) return 0;
  let behind = 0;
  for (const h of habits) {
    if (!h.active || isVice(h)) continue;
    for (let i = 1; i <= windowDays; i++) {
      const iso = formatISO(addDays(today, -i));
      if (isDueOn(h, iso) && !isSatisfied(h, iso)) {
        behind++;
        break;
      }
    }
  }
  return behind;
}

/**
 * Backlog reported by the sibling plugins (Brewin Planner, Brewin Fitness), read from their own
 * shared backlog notes. All-zero when a sibling plugin isn't installed/enabled or hasn't written
 * yet — never an error; a disabled plugin's last-known counts (or zero, if it never ran) is
 * exactly what should be used rather than blocking on it.
 */
export interface ExternalBacklog {
  tasksOverdue: number;
  tasksSlipped: number;
  fitnessMissed: number;
}

export const EMPTY_EXTERNAL_BACKLOG: ExternalBacklog = { tasksOverdue: 0, tasksSlipped: 0, fitnessMissed: 0 };

/** Everything reported by the sibling plugins, summed into one count. */
export function crossPluginBacklogItems(ext: ExternalBacklog): number {
  return ext.tasksOverdue + ext.tasksSlipped + ext.fitnessMissed;
}

/** Total backlog items: habits behind plus whatever the sibling plugins report. The single number
 *  the cash-in chance, the hard block and the on-screen breakdown all use. */
export function backlogItemsFor(habits: Habit[], ext: ExternalBacklog, dateISO: string, windowDays: number): number {
  return habitsBehind(habits, dateISO, windowDays) + crossPluginBacklogItems(ext);
}

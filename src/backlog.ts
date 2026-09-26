// Pure cross-plugin backlog logic. No Obsidian imports → unit-testable.
//
// Two backlog signals live here, both scoped to BUILD habits — vices already have their own
// penalty via vicesSlippedOn in rewards.ts, and this module deliberately never touches vices, so
// the two penalties can't double-count the same slip:
//
//  - dueUnmetToday: build habits due today that aren't satisfied YET. Today is still "pending"
//    elsewhere in this plugin (currentStreak doesn't break on it), so this is a softer signal
//    than a missed day — it's "still open", not "already lost".
//  - habitBacklogDays: due-days STRICTLY BEFORE today that were missed, over a trailing window.
//    Today is excluded so it composes additively with dueUnmetToday without double-counting.

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

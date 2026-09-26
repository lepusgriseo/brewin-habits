// Pure data model — no Obsidian imports, so this stays unit-testable.

export type HabitKind = "binary" | "count";

/**
 * `build` — something to do (target is a minimum to reach).
 * `avoid` — a vice: the target is an allowed MAXIMUM, and a clean day is one at or under it.
 */
export type HabitPolarity = "build" | "avoid";

export interface Habit {
  path: string;
  title: string;
  /** iCal RRULE describing when the habit is "due" (e.g. FREQ=DAILY, FREQ=WEEKLY;BYDAY=MO,WE,FR). */
  cadence: string;
  kind: HabitKind;
  polarity: HabitPolarity;
  /** For `build`: the minimum to hit. For `avoid`: the most you'll allow (0 = abstain). */
  target: number;
  unit: string;
  /** Increment applied per tap for count habits. */
  step: number;
  /** date (ISO) → value logged that day. Binary satisfied = 1. */
  log: Record<string, number>;
  active: boolean;
  created: string | null;
  modified: string | null;
}

// ── Habit rewards ────────────────────────────────────────────────────────────

export interface Reward {
  name: string;
  /** Points required to attempt cashing this in. */
  cost: number;
}

export interface Redemption {
  date: string; // ISO
  reward: string;
  cost: number;
  won: boolean;
}

export interface RewardsState {
  points: number;
  rewards: Reward[];
  /** Dates the perfect-day bonus already fired — lets it be clawed back if the day stops
   *  being perfect (a habit gets unmarked), and stops it firing twice for the same date. */
  perfectDays: string[];
  /** Most-recent-first, capped. */
  redemptions: Redemption[];
}

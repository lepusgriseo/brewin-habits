// Pure habit-rewards logic. No Obsidian imports → unit-testable.
//
// Points are earned continuously (per habit completion, plus a bonus for a fully clean/
// complete day) and spent trying to cash in a user-defined reward. Vices don't dock points
// directly — they reduce the CHANCE that a cash-in attempt succeeds, and that cost is real:
// the points are spent on the attempt whether it wins or loses (see resolveCashIn). A refund
// on a loss would make the chance cosmetic, which is exactly what would make vices toothless.
//
// Award/claw-back is TRANSITION-based throughout (compare before vs. after), not state-based —
// that's what makes marking a habit and then unmarking it net to zero rather than an exploit.

import { isDueOn, isSatisfied, isVice, valueOn } from "./habit";
import { Habit, Redemption, RewardsState } from "./types";

const MAX_REDEMPTIONS = 20;

/** How many DISTINCT vices have any slip logged today. One vice hammered repeatedly (a
 *  count-type habit incremented several times) still only counts once — the penalty is for
 *  "how many different vices", not "how much of one". */
export function vicesSlippedOn(habits: Habit[], dateISO: string): number {
  return habits.filter((h) => h.active && isVice(h) && valueOn(h, dateISO) > 0).length;
}

/** Today's cash-in success chance (a percentage, 0–100), floored so it's never zero. */
export function todaysChance(
  vicesSlippedToday: number,
  baseChance: number,
  penaltyPerVice: number,
  minChance: number
): number {
  return Math.max(minChance, baseChance - vicesSlippedToday * penaltyPerVice);
}

/**
 * Every ACTIVE habit actually due today — build or vice — satisfied. A day with nothing due
 * isn't "perfect", it's just empty; there's nothing to reward.
 */
export function isPerfectDay(habits: Habit[], dateISO: string): boolean {
  const due = habits.filter((h) => h.active && isDueOn(h, dateISO));
  if (!due.length) return false;
  return due.every((h) => isSatisfied(h, dateISO));
}

/**
 * Points for ONE habit's transition on `dateISO` — false→true awards, true→false claws back,
 * no change otherwise. "Satisfied" here already folds in due-ness (the caller passes false for
 * a habit that isn't due, regardless of its raw log value) so nothing is rewarded for a day the
 * habit was never asking anything of you.
 */
export function applyCompletionTransition(
  state: RewardsState,
  wasSatisfied: boolean,
  isSatisfiedNow: boolean,
  pointsPerCompletion: number
): RewardsState {
  if (wasSatisfied === isSatisfiedNow) return state;
  const delta = isSatisfiedNow ? pointsPerCompletion : -pointsPerCompletion;
  return { ...state, points: Math.max(0, state.points + delta) };
}

/**
 * Add/remove the perfect-day bonus so it fires exactly once per date and reverses cleanly if
 * the day stops being perfect (a habit gets unmarked after the bonus already landed).
 */
export function syncPerfectDay(state: RewardsState, dateISO: string, isPerfect: boolean, bonus: number): RewardsState {
  const already = state.perfectDays.includes(dateISO);
  if (isPerfect && !already) {
    return { ...state, points: state.points + bonus, perfectDays: [...state.perfectDays, dateISO].sort() };
  }
  if (!isPerfect && already) {
    return {
      ...state,
      points: Math.max(0, state.points - bonus),
      perfectDays: state.perfectDays.filter((d) => d !== dateISO),
    };
  }
  return state;
}

/**
 * Vice penalty, then backlog penalty, applied in sequence. Two sequential floor-clamped
 * subtractions compose the same as one combined subtraction once the floor is hit (a second
 * clamp on an already-floored value is a no-op) — so this reuses todaysChance twice rather than
 * inventing a second formula.
 */
export function combinedChance(
  vicesSlippedToday: number,
  backlogItems: number,
  baseChance: number,
  penaltyPerVice: number,
  penaltyPerBacklogItem: number,
  minChance: number
): number {
  const afterVices = todaysChance(vicesSlippedToday, baseChance, penaltyPerVice, minChance);
  return todaysChance(backlogItems, afterVices, penaltyPerBacklogItem, minChance);
}

/**
 * Backlog bad enough that a cash-in is refused outright rather than merely unlikely. Deliberately
 * scoped to backlog only — vices continue to only ever degrade odds down to the existing floor,
 * never block, so today's vice-only behaviour is unchanged when there's no backlog.
 */
export function isBacklogBlocked(backlogItems: number, threshold: number): boolean {
  return threshold > 0 && backlogItems >= threshold;
}

export interface CashInResult {
  ok: boolean;
  /** Only meaningful when ok is true. */
  won?: boolean;
  /** Only meaningful when ok is false — why nothing happened. */
  reason?: string;
  /** Only meaningful when ok is true — the state to persist. */
  state?: RewardsState;
}

/**
 * Attempt to cash in `rewardName`. `rng` is injected (rather than calling Math.random directly)
 * so this stays deterministic and testable; the caller supplies Math.random in real use.
 * Points are spent on the attempt regardless of outcome — see the module note above for why.
 */
export function resolveCashIn(
  state: RewardsState,
  rewardName: string,
  chancePercent: number,
  todayISO: string,
  rng: () => number
): CashInResult {
  const reward = state.rewards.find((r) => r.name === rewardName);
  if (!reward) return { ok: false, reason: "That reward no longer exists." };
  if (state.points < reward.cost) return { ok: false, reason: "Not enough points yet." };

  const won = rng() < chancePercent / 100;
  const redemption: Redemption = { date: todayISO, reward: reward.name, cost: reward.cost, won };
  return {
    ok: true,
    won,
    state: {
      ...state,
      points: state.points - reward.cost,
      redemptions: [redemption, ...state.redemptions].slice(0, MAX_REDEMPTIONS),
    },
  };
}

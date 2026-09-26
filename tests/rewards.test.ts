import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCompletionTransition,
  combinedChance,
  isBacklogBlocked,
  isPerfectDay,
  resolveCashIn,
  syncPerfectDay,
  todaysChance,
  vicesSlippedOn,
} from "../src/rewards.ts";
import { Habit, RewardsState } from "../src/types.ts";

const TODAY = "2026-08-29";

function mk(p: Partial<Habit>): Habit {
  return {
    path: "Habits/h.md", title: "h", cadence: "FREQ=DAILY", kind: "binary", polarity: "build",
    target: 1, unit: "", step: 1, log: {}, active: true, created: "2026-07-01", modified: "2026-07-01",
    ...p,
  };
}

function state(p: Partial<RewardsState> = {}): RewardsState {
  return { points: 0, rewards: [], perfectDays: [], redemptions: [], ...p };
}

// ── todaysChance / vicesSlippedOn ─────────────────────────────────────────────

test("todaysChance drops by the penalty per distinct vice, floored at minChance", () => {
  assert.equal(todaysChance(0, 90, 15, 10), 90);
  assert.equal(todaysChance(1, 90, 15, 10), 75);
  assert.equal(todaysChance(2, 90, 15, 10), 60);
  assert.equal(todaysChance(10, 90, 15, 10), 10); // floored, not negative
});

test("vicesSlippedOn counts distinct vices, not total increments", () => {
  const smoking = mk({ title: "Smoking", polarity: "avoid", kind: "count", target: 0, log: { [TODAY]: 5 } });
  const drinking = mk({ title: "Drinking", polarity: "avoid", target: 0, log: { [TODAY]: 1 } });
  const clean = mk({ title: "Junk food", polarity: "avoid", target: 0, log: {} });
  const aBuildHabit = mk({ title: "Exercise", polarity: "build", log: { [TODAY]: 1 } });
  assert.equal(vicesSlippedOn([smoking, drinking, clean, aBuildHabit], TODAY), 2);
});

test("vicesSlippedOn ignores inactive vices", () => {
  const inactive = mk({ polarity: "avoid", target: 0, active: false, log: { [TODAY]: 1 } });
  assert.equal(vicesSlippedOn([inactive], TODAY), 0);
});

// ── isPerfectDay ───────────────────────────────────────────────────────────

test("a day with nothing due is not perfect — there's nothing to reward", () => {
  const notDueToday = mk({ cadence: "FREQ=WEEKLY;BYDAY=MO", created: "2026-01-05" }); // a Monday-only habit
  assert.equal(isPerfectDay([notDueToday], TODAY), false); // 2026-08-29 is a Saturday
});

test("a perfect day needs every due habit AND every due vice satisfied", () => {
  const habit = mk({ title: "Exercise", log: { [TODAY]: 1 } });
  const vice = mk({ title: "Smoking", polarity: "avoid", target: 0, log: {} }); // clean
  assert.equal(isPerfectDay([habit, vice], TODAY), true);
});

test("one unsatisfied due habit breaks the perfect day", () => {
  const done = mk({ title: "Exercise", log: { [TODAY]: 1 } });
  const notDone = mk({ title: "Read", log: {} });
  assert.equal(isPerfectDay([done, notDone], TODAY), false);
});

test("a slipped vice breaks the perfect day even if every build habit is done", () => {
  const done = mk({ title: "Exercise", log: { [TODAY]: 1 } });
  const slipped = mk({ title: "Smoking", polarity: "avoid", target: 0, log: { [TODAY]: 1 } });
  assert.equal(isPerfectDay([done, slipped], TODAY), false);
});

// ── applyCompletionTransition ─────────────────────────────────────────────────

test("marking a habit satisfied awards points; unmarking claws them back to zero net", () => {
  let s = state({ points: 10 });
  s = applyCompletionTransition(s, false, true, 5);
  assert.equal(s.points, 15);
  s = applyCompletionTransition(s, true, false, 5);
  assert.equal(s.points, 10);
});

test("no transition, no change", () => {
  const s = state({ points: 10 });
  assert.equal(applyCompletionTransition(s, true, true, 5).points, 10);
  assert.equal(applyCompletionTransition(s, false, false, 5).points, 10);
});

test("claw-back never takes points negative", () => {
  const s = applyCompletionTransition(state({ points: 2 }), true, false, 5);
  assert.equal(s.points, 0);
});

// ── syncPerfectDay ────────────────────────────────────────────────────────────

test("the perfect-day bonus fires once per date and reverses if undone", () => {
  let s = state({ points: 0 });
  s = syncPerfectDay(s, TODAY, true, 20);
  assert.equal(s.points, 20);
  assert.deepEqual(s.perfectDays, [TODAY]);

  // Firing again for the same date (e.g. re-render) must not double-award.
  s = syncPerfectDay(s, TODAY, true, 20);
  assert.equal(s.points, 20);

  // The day stops being perfect (a habit got unmarked) — claw it back.
  s = syncPerfectDay(s, TODAY, false, 20);
  assert.equal(s.points, 0);
  assert.deepEqual(s.perfectDays, []);
});

test("syncPerfectDay never takes points negative even if the bonus was already spent", () => {
  let s = state({ points: 20, perfectDays: [TODAY] });
  s = { ...s, points: 5 }; // spent most of it on a reward in between
  s = syncPerfectDay(s, TODAY, false, 20);
  assert.equal(s.points, 0);
});

// ── resolveCashIn ─────────────────────────────────────────────────────────────

test("resolveCashIn rejects a reward that doesn't exist, without mutating state", () => {
  const s = state({ points: 100, rewards: [{ name: "Movie", cost: 30 }] });
  const res = resolveCashIn(s, "Nope", 90, TODAY, () => 0);
  assert.equal(res.ok, false);
  assert.ok(res.reason);
});

test("resolveCashIn rejects insufficient points, without mutating state", () => {
  const s = state({ points: 10, rewards: [{ name: "Movie", cost: 30 }] });
  const res = resolveCashIn(s, "Movie", 90, TODAY, () => 0);
  assert.equal(res.ok, false);
  assert.match(res.reason ?? "", /enough points/i);
});

test("resolveCashIn spends points on the attempt whether it wins or loses", () => {
  const s = state({ points: 100, rewards: [{ name: "Movie", cost: 30 }] });

  const win = resolveCashIn(s, "Movie", 90, TODAY, () => 0); // rng below chance → win
  assert.equal(win.ok, true);
  assert.equal(win.won, true);
  assert.equal(win.state?.points, 70);

  const lose = resolveCashIn(s, "Movie", 90, TODAY, () => 0.99); // rng above chance → lose
  assert.equal(lose.ok, true);
  assert.equal(lose.won, false);
  assert.equal(lose.state?.points, 70); // spent regardless of outcome
});

test("resolveCashIn is deterministic for a fixed rng and records the redemption", () => {
  const s = state({ points: 100, rewards: [{ name: "Movie", cost: 30 }] });
  const res = resolveCashIn(s, "Movie", 50, TODAY, () => 0.4);
  assert.equal(res.won, true); // 0.4 < 0.5
  assert.deepEqual(res.state?.redemptions[0], { date: TODAY, reward: "Movie", cost: 30, won: true });
});

// ── combinedChance / isBacklogBlocked ─────────────────────────────────────────

test("combinedChance with no vices and no backlog equals the base chance", () => {
  assert.equal(combinedChance(0, 0, 90, 15, 5, 10), 90);
});

test("combinedChance applies the vice penalty then the backlog penalty, in sequence", () => {
  // 90 - 1*15 (vice) = 75, then 75 - 2*5 (backlog) = 65
  assert.equal(combinedChance(1, 2, 90, 15, 5, 10), 65);
});

test("combinedChance floors at minChance even with both penalties stacked", () => {
  assert.equal(combinedChance(10, 10, 90, 15, 5, 10), 10);
});

test("combinedChance with backlog disabled upstream (0 items) matches todaysChance exactly", () => {
  assert.equal(combinedChance(2, 0, 90, 15, 5, 10), todaysChance(2, 90, 15, 10));
});

test("isBacklogBlocked is false below threshold, true at/above it", () => {
  assert.equal(isBacklogBlocked(9, 10), false);
  assert.equal(isBacklogBlocked(10, 10), true);
  assert.equal(isBacklogBlocked(50, 10), true);
});

test("isBacklogBlocked never blocks when threshold is 0 (disabled)", () => {
  assert.equal(isBacklogBlocked(1000, 0), false);
});

test("resolveCashIn keeps redemption history capped, most-recent-first", () => {
  let s = state({ points: 1000, rewards: [{ name: "Coffee", cost: 1 }] });
  for (let i = 0; i < 25; i++) {
    const res = resolveCashIn(s, "Coffee", 100, `2026-08-${String(i + 1).padStart(2, "0")}`, () => 0);
    s = res.state!;
  }
  assert.equal(s.redemptions.length, 20);
  assert.equal(s.redemptions[0].date, "2026-08-25"); // the most recent one is first
});

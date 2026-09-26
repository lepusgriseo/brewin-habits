import { test } from "node:test";
import assert from "node:assert/strict";
import { crossPluginBacklogItems, dueUnmetToday, habitBacklogDays } from "../src/backlog.ts";
import { Habit } from "../src/types.ts";

const TODAY = "2026-08-29"; // a Saturday

function mk(p: Partial<Habit>): Habit {
  return {
    path: "Habits/h.md", title: "h", cadence: "FREQ=DAILY", kind: "binary", polarity: "build",
    target: 1, unit: "", step: 1, log: {}, active: true, created: "2026-07-01", modified: "2026-07-01",
    ...p,
  };
}

// ── dueUnmetToday ────────────────────────────────────────────────────────────

test("dueUnmetToday counts due, unsatisfied BUILD habits only", () => {
  const unmet = mk({ title: "Exercise", log: {} });
  const met = mk({ title: "Read", log: { [TODAY]: 1 } });
  const notDueToday = mk({ title: "Weekly", cadence: "FREQ=WEEKLY;BYDAY=MO", created: "2026-01-05" });
  assert.equal(dueUnmetToday([unmet, met, notDueToday], TODAY), 1);
});

test("dueUnmetToday ignores vices — those have their own penalty via vicesSlippedOn", () => {
  const slippedVice = mk({ title: "Smoking", polarity: "avoid", target: 0, log: { [TODAY]: 1 } });
  assert.equal(dueUnmetToday([slippedVice], TODAY), 0);
});

test("dueUnmetToday ignores inactive habits", () => {
  const inactive = mk({ active: false, log: {} });
  assert.equal(dueUnmetToday([inactive], TODAY), 0);
});

// ── habitBacklogDays ─────────────────────────────────────────────────────────

test("habitBacklogDays counts missed due-days in the trailing window, excluding today", () => {
  // Daily habit, logged nothing at all over the last week.
  const h = mk({ cadence: "FREQ=DAILY", log: {} });
  assert.equal(habitBacklogDays([h], TODAY, 3), 3); // the 3 days strictly before TODAY
});

test("habitBacklogDays excludes today itself — dueUnmetToday covers that instead", () => {
  const h = mk({ cadence: "FREQ=DAILY", log: {} });
  const withToday = habitBacklogDays([h], TODAY, 1);
  assert.equal(withToday, 1); // only yesterday, not today
});

test("habitBacklogDays counts a satisfied day as not missed", () => {
  const h = mk({
    cadence: "FREQ=DAILY",
    log: { "2026-08-28": 1, "2026-08-27": 1, "2026-08-26": 1 }, // all 3 prior days done
  });
  assert.equal(habitBacklogDays([h], TODAY, 3), 0);
});

test("habitBacklogDays respects cadence — a Monday-only habit isn't 'missed' on other days", () => {
  const h = mk({ cadence: "FREQ=WEEKLY;BYDAY=MO", created: "2026-01-05", log: {} });
  // Window covers the whole week ending the Friday before TODAY — Monday 2026-08-24 is due,
  // Tue–Fri aren't due at all so they can't count as missed.
  assert.equal(habitBacklogDays([h], TODAY, 5), 1);
});

test("habitBacklogDays with windowDays 0 is always 0", () => {
  const h = mk({ cadence: "FREQ=DAILY", log: {} });
  assert.equal(habitBacklogDays([h], TODAY, 0), 0);
});

test("habitBacklogDays ignores vices and inactive habits", () => {
  const vice = mk({ polarity: "avoid", target: 0, log: {} });
  const inactive = mk({ active: false, log: {} });
  assert.equal(habitBacklogDays([vice, inactive], TODAY, 7), 0);
});

// ── crossPluginBacklogItems ────────────────────────────────────────────────

test("crossPluginBacklogItems sums everything the sibling plugins report", () => {
  assert.equal(crossPluginBacklogItems({ tasksOverdue: 3, tasksSlipped: 2, fitnessMissed: 1 }), 6);
  assert.equal(crossPluginBacklogItems({ tasksOverdue: 0, tasksSlipped: 0, fitnessMissed: 0 }), 0);
});

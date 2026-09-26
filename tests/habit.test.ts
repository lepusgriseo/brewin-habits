import { test } from "node:test";
import assert from "node:assert/strict";
import {
  habitFromFrontmatter,
  isDueOn,
  isSatisfied,
  isBreach,
  isVice,
  currentStreak,
  withMarked,
  withValue,
  heatmapCells,
  ratioOn,
} from "../src/habit.ts";
import { Habit } from "../src/types.ts";

function mk(p: Partial<Habit>): Habit {
  return {
    path: "Habits/h.md",
    title: "h",
    cadence: "FREQ=DAILY",
    kind: "binary",
    polarity: "build",
    target: 1,
    unit: "",
    step: 1,
    log: {},
    active: true,
    created: "2026-07-01",
    modified: "2026-07-01",
    ...p,
  };
}

test("parse binary vs count from frontmatter", () => {
  const b = habitFromFrontmatter({ kind: "binary", cadence: "FREQ=DAILY", log: { "2026-07-24": 1 } }, "Habits/Meditate.md", "Meditate");
  assert.equal(b.kind, "binary");
  assert.equal(b.target, 1);
  assert.equal(b.log["2026-07-24"], 1);

  const c = habitFromFrontmatter({ kind: "count", target: 3000, unit: "ml", step: 500, log: { "2026-07-24": 2500 } }, "Habits/Water.md", "Water");
  assert.equal(c.kind, "count");
  assert.equal(c.target, 3000);
  assert.equal(c.step, 500);
  assert.equal(c.log["2026-07-24"], 2500);
});

test("isDueOn: daily is always due; weekly respects BYDAY", () => {
  const daily = mk({ cadence: "FREQ=DAILY" });
  assert.equal(isDueOn(daily, "2026-07-24"), true);
  assert.equal(isDueOn(daily, "2026-07-25"), true);

  const mon = mk({ cadence: "FREQ=WEEKLY;BYDAY=MO", created: "2026-07-06" });
  assert.equal(isDueOn(mon, "2026-07-27"), true); // Monday
  assert.equal(isDueOn(mon, "2026-07-28"), false); // Tuesday
});

test("count satisfaction + ratio", () => {
  const w = mk({ kind: "count", target: 3000, step: 500, log: { "2026-07-24": 2500, "2026-07-23": 3000 } });
  assert.equal(isSatisfied(w, "2026-07-24"), false);
  assert.equal(isSatisfied(w, "2026-07-23"), true);
  assert.equal(ratioOn(w, "2026-07-24"), 2500 / 3000);
});

test("daily streak: consecutive days, today pending does not break", () => {
  const h = mk({ cadence: "FREQ=DAILY", log: { "2026-07-22": 1, "2026-07-23": 1, "2026-07-24": 1 } });
  assert.equal(currentStreak(h, "2026-07-24"), 3);

  const pending = mk({ cadence: "FREQ=DAILY", log: { "2026-07-22": 1, "2026-07-23": 1 } });
  assert.equal(currentStreak(pending, "2026-07-24"), 2); // today not done yet, streak intact

  const gap = mk({ cadence: "FREQ=DAILY", log: { "2026-07-24": 1, "2026-07-22": 1 } }); // 23 missing
  assert.equal(currentStreak(gap, "2026-07-24"), 1); // breaks at 23
});

test("weekly streak counts only due-days", () => {
  const mon = mk({ cadence: "FREQ=WEEKLY;BYDAY=MO", created: "2026-07-06", log: { "2026-07-13": 1, "2026-07-20": 1, "2026-07-27": 1 } });
  assert.equal(currentStreak(mon, "2026-07-27"), 3);
});

test("withMarked: binary toggles, count increments/decrements", () => {
  const b = mk({ kind: "binary" });
  const on = withMarked(b, "2026-07-24", "toggle");
  assert.equal(on["2026-07-24"], 1);
  const off = withMarked({ ...b, log: on }, "2026-07-24", "toggle");
  assert.equal(off["2026-07-24"], undefined);

  const c = mk({ kind: "count", target: 3000, step: 500, log: {} });
  let log = withMarked(c, "2026-07-24", "inc");
  assert.equal(log["2026-07-24"], 500);
  log = withMarked({ ...c, log }, "2026-07-24", "inc");
  assert.equal(log["2026-07-24"], 1000);
  log = withMarked({ ...c, log }, "2026-07-24", "dec");
  assert.equal(log["2026-07-24"], 500);
  log = withMarked({ ...c, log }, "2026-07-24", "dec");
  assert.equal(log["2026-07-24"], undefined); // dropped to 0
});

test("withValue: sets an absolute value for a back-filled day", () => {
  const b = mk({ kind: "binary" });
  assert.equal(withValue(b, "2026-07-20", 1)["2026-07-20"], 1);
  assert.equal(withValue(b, "2026-07-20", 5)["2026-07-20"], 1); // binary clamps to 1
  assert.equal(withValue({ ...b, log: { "2026-07-20": 1 } }, "2026-07-20", 0)["2026-07-20"], undefined);

  const c = mk({ kind: "count", target: 3000, step: 500, log: { "2026-07-20": 500 } });
  assert.equal(withValue(c, "2026-07-20", 2200)["2026-07-20"], 2200); // absolute, not additive
  assert.equal(withValue(c, "2026-07-20", 0)["2026-07-20"], undefined);
  assert.equal(withValue(c, "2026-07-20", -3)["2026-07-20"], undefined); // never negative
  assert.equal(withValue(c, "2026-07-20", 12.9)["2026-07-20"], 12); // floored

  // does not mutate the input log
  const original = { "2026-07-20": 500 };
  withValue({ ...c, log: original }, "2026-07-20", 999);
  assert.equal(original["2026-07-20"], 500);
});

// ── Vices (polarity: "avoid") ────────────────────────────────────────────────

test("a vice is satisfied by NOT doing it — an untouched day is already a win", () => {
  const smoke = mk({ polarity: "avoid", kind: "binary", target: 0, log: { "2026-07-23": 1 } });
  assert.equal(isSatisfied(smoke, "2026-07-22"), true); // nothing logged → clean
  assert.equal(isSatisfied(smoke, "2026-07-23"), false); // slipped
  assert.equal(isBreach(smoke, "2026-07-23"), true);
  assert.equal(isBreach(smoke, "2026-07-22"), false);
});

test("a vice with an allowance breaches only ABOVE the limit", () => {
  // "at most 2 a day"
  const v = mk({ polarity: "avoid", kind: "count", target: 2, step: 1, log: { "2026-07-22": 2, "2026-07-23": 3 } });
  assert.equal(isSatisfied(v, "2026-07-22"), true); // exactly at the limit is fine
  assert.equal(isBreach(v, "2026-07-22"), false);
  assert.equal(isSatisfied(v, "2026-07-23"), false); // over
  assert.equal(isBreach(v, "2026-07-23"), true);
});

test("a vice's streak counts consecutive CLEAN days and a slip breaks it", () => {
  // Created 1 Jul, never logged → every day since counts as clean (1st–24th = 24 days).
  const clean = mk({ polarity: "avoid", kind: "binary", target: 0, log: {}, created: "2026-07-01" });
  assert.equal(currentStreak(clean, "2026-07-24"), 24);

  const slipped = mk({ polarity: "avoid", kind: "binary", target: 0, log: { "2026-07-22": 1 } });
  assert.equal(currentStreak(slipped, "2026-07-24"), 2); // the 23rd and 24th only
});

test("a normal habit is unaffected by the vice logic", () => {
  const h = mk({ polarity: "build", kind: "count", target: 3000, log: { "2026-07-24": 3000 } });
  assert.equal(isSatisfied(h, "2026-07-24"), true);
  assert.equal(isBreach(h, "2026-07-24"), false); // exceeding a build target is never a breach
  assert.equal(isVice(h), false);
});

test("heatmap marks a vice breach distinctly from progress", () => {
  const v = mk({ polarity: "avoid", kind: "binary", target: 0, log: { "2026-07-24": 1 } });
  const cell = heatmapCells(v, "2026-07-24", 1, 1).flat().find((c) => c.date === "2026-07-24")!;
  assert.equal(cell.breach, true);
  assert.equal(cell.satisfied, false);
});

test("heatmapCells returns weeks×7 grid ending at current week", () => {
  const h = mk({ cadence: "FREQ=DAILY", log: { "2026-07-24": 1 } });
  const grid = heatmapCells(h, "2026-07-24", 12, 1); // Monday start
  assert.equal(grid.length, 12);
  grid.forEach((col) => assert.equal(col.length, 7));
  // the cell for today should be satisfied
  const flat = grid.flat();
  const today = flat.find((c) => c.date === "2026-07-24");
  assert.ok(today && today.satisfied);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dailyScores,
  formatWeekHabitBlock,
  heatLevel,
  heatStats,
  toWeekColumns,
  weekHabitReview,
} from "../src/analytics.ts";
import { Habit } from "../src/types.ts";

function mk(p: Partial<Habit>): Habit {
  return {
    path: "h.md", title: "h", cadence: "FREQ=DAILY", kind: "binary", polarity: "build",
    target: 1, unit: "", step: 1, log: {}, active: true,
    created: "2026-07-01", modified: "2026-07-01", ...p,
  };
}

test("dailyScores counts how many due habits were satisfied each day", () => {
  const a = mk({ path: "a", log: { "2026-07-02": 1 } });
  const b = mk({ path: "b", log: { "2026-07-01": 1, "2026-07-02": 1 } });
  const s = dailyScores([a, b], "2026-07-01", "2026-07-02", "2026-07-31");
  assert.deepEqual(s.map((d) => [d.date, d.done, d.due]), [
    ["2026-07-01", 1, 2],
    ["2026-07-02", 2, 2],
  ]);
  assert.equal(s[1].ratio, 1);
});

test("a day with nothing due scores null, not zero — a rest day isn't a failure", () => {
  // Mondays only; 2026-07-01 is a Wednesday.
  const mon = mk({ cadence: "FREQ=WEEKLY;BYDAY=MO", created: "2026-06-29" });
  const s = dailyScores([mon], "2026-07-01", "2026-07-01", "2026-07-31");
  assert.equal(s[0].due, 0);
  assert.equal(s[0].ratio, null);
  assert.equal(heatLevel(s[0]), -1); // nothing to shade
});

test("a vice going over flags the day as a breach", () => {
  const vice = mk({ polarity: "avoid", target: 0, log: { "2026-07-02": 1 } });
  const s = dailyScores([vice], "2026-07-01", "2026-07-02", "2026-07-31");
  assert.equal(s[0].breach, false); // clean day
  assert.equal(s[0].ratio, 1); // an untouched vice IS a satisfied day
  assert.equal(s[1].breach, true);
  assert.equal(s[1].ratio, 0);
});

test("future days are marked and never shaded", () => {
  const h = mk({});
  const s = dailyScores([h], "2026-07-01", "2026-07-03", "2026-07-01");
  assert.deepEqual(s.map((d) => d.future), [false, true, true]);
  assert.equal(heatLevel(s[1]), -1);
});

test("heatLevel buckets the ratio 0–4", () => {
  const at = (ratio: number | null) => heatLevel({ date: "d", due: 1, done: 1, ratio, breach: false, future: false });
  assert.equal(at(1), 4);
  assert.equal(at(0.7), 3);
  assert.equal(at(0.5), 2);
  assert.equal(at(0.1), 1);
  assert.equal(at(0), 0);
  assert.equal(at(null), -1);
});

test("heatStats: perfect days, best run, and rest days don't break a streak", () => {
  const scores = [
    { date: "1", due: 1, done: 1, ratio: 1, breach: false, future: false },
    { date: "2", due: 0, done: 0, ratio: null, breach: false, future: false }, // rest day
    { date: "3", due: 1, done: 1, ratio: 1, breach: false, future: false },
    { date: "4", due: 2, done: 1, ratio: 0.5, breach: false, future: false }, // breaks it
    { date: "5", due: 1, done: 1, ratio: 1, breach: true, future: false },
  ];
  const s = heatStats(scores);
  assert.equal(s.perfectDays, 3);
  assert.equal(s.activeDays, 4); // the rest day isn't counted
  assert.equal(s.bestStreak, 2); // days 1 and 3, bridged by the rest day
  assert.equal(s.breaches, 1);
});

test("toWeekColumns pads the first week so rows are consistent weekdays", () => {
  // 2026-07-01 is a Wednesday → Monday-start weeks need 2 leading pads.
  const s = dailyScores([mk({})], "2026-07-01", "2026-07-14", "2026-07-31");
  const cols = toWeekColumns(s, 1);
  assert.equal(cols[0].length, 7);
  assert.equal(cols[0][0], null);
  assert.equal(cols[0][1], null);
  assert.equal(cols[0][2]?.date, "2026-07-01");
  cols.forEach((c) => assert.equal(c.length, 7)); // every column is a full week
});

// ── weekHabitReview / formatWeekHabitBlock ───────────────────────────────────

const WK_FROM = "2026-09-07"; // Mon, ISO-W37
const WK_TO = "2026-09-13"; // Sun
const WK_TODAY = "2026-09-10"; // Thu — Mon–Wed past, today, Fri–Sun ahead

test("weekHabitReview: a build habit splits into hit / missed / pending around today", () => {
  const h = mk({ path: "read", title: "Reading", created: "2026-08-01",
    log: { "2026-09-07": 1, "2026-09-08": 1, "2026-09-10": 1 } });
  const r = weekHabitReview([h], WK_FROM, WK_TO, WK_TODAY);
  assert.equal(r.perHabit.length, 1);
  const row = r.perHabit[0];
  assert.deepEqual(
    [row.due, row.hit, row.missed, row.pending, row.slips],
    [7, 3, 1, 3, 0]
  );
  assert.equal(row.streak, 1); // satisfied today, broken by the miss on the 9th
});

test("weekHabitReview: a cadence only counts the days it's actually due", () => {
  const mwf = mk({ path: "gym", title: "Gym", cadence: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    created: "2026-08-31", log: { "2026-09-07": 1 } });
  const r = weekHabitReview([mwf], WK_FROM, WK_TO, WK_TODAY);
  const row = r.perHabit[0];
  // due: Mon 07, Wed 09, Fri 11 → 3. hit: 07. missed: 09. pending: 11.
  assert.deepEqual([row.due, row.hit, row.missed, row.pending], [3, 1, 1, 1]);
});

test("weekHabitReview: a vice reports clean days and slips, not hit/miss", () => {
  const vice = mk({ path: "cig", title: "Cigars", polarity: "avoid", target: 0,
    created: "2026-08-01", log: { "2026-09-08": 1 } });
  const r = weekHabitReview([vice], WK_FROM, WK_TO, WK_TODAY);
  const row = r.perHabit[0];
  assert.deepEqual([row.due, row.hit, row.missed, row.slips], [7, 3, 1, 1]);
  const md = formatWeekHabitBlock(r, { weekLabel: "2026-W37", startISO: WK_FROM, endISO: WK_TO, generatedISO: WK_TODAY });
  assert.match(md, /\| Cigars \(avoid\) \| 3 clean \| 1 slip \| \d+ \|/);
});

test("weekHabitReview: inactive habits and habits not due this week are dropped", () => {
  const off = mk({ path: "x", title: "Paused", active: false });
  const monthly = mk({ path: "m", title: "Monthly", cadence: "FREQ=MONTHLY;BYMONTHDAY=1", created: "2026-01-01" });
  const r = weekHabitReview([off, monthly], WK_FROM, WK_TO, WK_TODAY);
  assert.deepEqual(r.perHabit.map((row) => row.habit.title), []);
});

test("weekHabitReview: totals match heatStats(dailyScores(...))", () => {
  const habits = [
    mk({ path: "a", title: "A", log: { "2026-09-07": 1, "2026-09-08": 1, "2026-09-09": 1, "2026-09-10": 1 } }),
    mk({ path: "b", title: "B", polarity: "avoid", target: 0, log: { "2026-09-09": 2 } }),
  ];
  const r = weekHabitReview(habits, WK_FROM, WK_TO, WK_TODAY);
  assert.deepEqual(r.totals, heatStats(dailyScores(habits, WK_FROM, WK_TO, WK_TODAY)));
});

test("formatWeekHabitBlock: table + aggregate line, with a pending note mid-week", () => {
  const habits = [mk({ path: "a", title: "A", created: "2026-08-01", log: { "2026-09-07": 1 } })];
  const r = weekHabitReview(habits, WK_FROM, WK_TO, WK_TODAY);
  const md = formatWeekHabitBlock(r, { weekLabel: "2026-W37", startISO: WK_FROM, endISO: WK_TO, generatedISO: WK_TODAY });
  assert.match(md, /^\*2026-W37 · .+ · generated 2026-09-10\*/);
  assert.match(md, /\| Habit \| Hit \| Missed \| Streak \|\n\| --- \| --- \| --- \| --- \|/);
  assert.match(md, /\*\*\d+ \/ \d+ full days · best run \d+/);
  assert.match(md, /_Some days this week are still pending\._/);
});

test("formatWeekHabitBlock: no active habits → a single italic line", () => {
  const md = formatWeekHabitBlock(weekHabitReview([], WK_FROM, WK_TO, WK_TODAY),
    { weekLabel: "2026-W37", startISO: WK_FROM, endISO: WK_TO, generatedISO: WK_TODAY });
  assert.match(md, /_No active habits for this week\._/);
});

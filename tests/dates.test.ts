import { test } from "node:test";
import assert from "node:assert/strict";
import { isoWeekOf, weekRange } from "../src/dates.ts";

test("isoWeekOf: every day of an ISO week resolves to the same label", () => {
  for (const d of ["2026-09-07", "2026-09-08", "2026-09-10", "2026-09-13"]) {
    assert.equal(isoWeekOf(d), "2026-W37");
  }
  assert.equal(isoWeekOf("2026-09-06"), "2026-W36");
  assert.equal(isoWeekOf("2026-09-14"), "2026-W38");
});

test("isoWeekOf: year boundaries follow the Thursday", () => {
  assert.equal(isoWeekOf("2026-12-31"), "2026-W53"); // 2026 is a 53-week year
  assert.equal(isoWeekOf("2027-01-02"), "2026-W53");
  assert.equal(isoWeekOf("2027-01-04"), "2027-W01");
  assert.equal(isoWeekOf("not a date"), "");
});

test("weekRange: a label maps to its Mon–Sun ISO dates", () => {
  assert.deepEqual(weekRange("2026-W37"), { start: "2026-09-07", end: "2026-09-13" });
  assert.deepEqual(weekRange("2026-W01"), { start: "2025-12-29", end: "2026-01-04" });
});

test("weekRange: a genuine W53 resolves; a phantom one is rejected", () => {
  assert.deepEqual(weekRange("2026-W53"), { start: "2026-12-28", end: "2027-01-03" });
  assert.equal(weekRange("2025-W53"), null);
});

test("weekRange: rejects anything that isn't a bare YYYY-Www label", () => {
  assert.equal(weekRange("2026-W37 Review"), null);
  assert.equal(weekRange("garbage"), null);
  assert.equal(weekRange("2026-W00"), null);
  assert.equal(weekRange(""), null);
});

test("weekRange: round-trips through isoWeekOf, end is always start + 6", () => {
  for (const label of ["2024-W01", "2025-W30", "2026-W37", "2026-W53", "2027-W01"]) {
    const r = weekRange(label);
    assert.ok(r, `${label} should resolve`);
    assert.equal(isoWeekOf(r!.start), label);
    assert.equal(isoWeekOf(r!.end), label);
  }
});

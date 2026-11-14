// The person's control values over a revision by the agent: kept for the controls that still exist and still allow them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { carryPrice, carryValues } from "./carry.ts";
import type { Control } from "./kit.ts";

const slider = (id: string, min: number, max: number, initial: number): Control => ({ id, type: "slider", label: id, meaning: id, min, max, step: 1, unit: "px", initial });
const select = (id: string, values: string[]): Control => ({ id, type: "select", label: id, meaning: id, initial: values[0], options: values.map((value) => ({ value, label: value })) });

test("a preview keeps the values that the revised controls still allow, and only after a revision", () => {
  const controls = [slider("radius", 0, 32, 6), slider("pad", 4, 12, 10), select("weight", ["500", "700"]), slider("gap", 0, 8, 2)];
  const base = { radius: 6, pad: 10, weight: "500", gap: 2 };
  const was = { rev: "r1", values: { radius: 14, pad: 18, weight: "600", gone: 3 } };
  // radius: still allowed. pad: 18 is outside the new range. weight: "600" is no longer an option. gap: new. gone: removed.
  assert.deepEqual(carryValues(controls, was, "r2", base), { radius: 14, pad: 10, weight: "500", gap: 2 });
  // The same revision: the screen keeps its own values (data arrived, nothing was revised).
  assert.equal(carryValues(controls, was, "r1", base), base);
  assert.equal(carryValues(controls, undefined, "r2", base), base);
});

test("a price screen keeps numbers inside the range or on an unchanged range, and what still exists", () => {
  const d = { metrics: [{ id: "emails", min: 1000, max: 100000 }, { id: "seats", min: 1, max: 50 }, { id: "gb", min: 0, max: 10 }], features: [{ id: "sso" }], vendors: [{ id: "resend" }] };
  const was = { spec: "old", usage: { emails: 250000, seats: 80, gb: 4, removed: 9 }, required: ["sso", "audit"], chosen: "postmark", tolerance: 5, ranges: { emails: [1000, 100000] as [number, number], seats: [1, 100] as [number, number], gb: [0, 10] as [number, number] } };
  // emails: typed beyond a range that did not change, kept. seats: outside the new, smaller range, dropped. gb: kept.
  assert.deepEqual(carryPrice(d, was, "new"), { usage: { emails: 250000, gb: 4 }, required: ["sso"], chosen: null, tolerance: 5 });
  assert.equal(carryPrice(d, was, "old"), null);
  assert.equal(carryPrice(d, undefined, "new"), null);
});

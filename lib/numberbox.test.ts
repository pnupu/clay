import assert from "node:assert/strict";
import { test } from "node:test";
import { commitNumber, liveNumber } from "./numberbox.ts";

test("number box: an empty box or text keeps the previous value and says so", () => {
  assert.deepEqual(commitNumber("", { min: 0, prev: 40000 }).value, 40000);
  assert.match(commitNumber("", { min: 0, prev: 40000 }).note!, /empty/);
  assert.deepEqual(commitNumber("banana", { min: 0, prev: 25 }).value, 25);
  assert.match(commitNumber("banana", { min: 0, prev: 25 }).note!, /not a number/);
  assert.equal(commitNumber("12abc", { min: 0, prev: 7 }).value, 7);
  // Separators alone, and a decimal comma, are not numbers: nothing is set silently.
  for (const t of [",", "_", "1 000", "12,5"]) assert.deepEqual(commitNumber(t, { min: 0, prev: 7 }).value, 7, t);
  assert.equal(liveNumber("1,5", { min: 0 }), null);
});

test("number box: a typed value is kept exactly; outside the range it goes to the nearest end, with a note", () => {
  assert.deepEqual(commitNumber("300000", { min: 1000, max: 500000, prev: 40000 }), { value: 300000, note: null });
  assert.deepEqual(commitNumber("300,000", { min: 1000, max: 500000, prev: 40000 }), { value: 300000, note: null });
  // A minus sign is never dropped: -5 is below 0, and the note says what was set.
  const neg = commitNumber("-5", { min: 0, prev: 25 });
  assert.equal(neg.value, 0);
  assert.match(neg.note!, /-5 is below 0/);
  const huge = commitNumber("999999999", { min: 1000, max: 500000, prev: 40000 });
  assert.equal(huge.value, 500000);
  assert.match(huge.note!, /above 500,000/);
  assert.deepEqual(commitNumber("12.5", { min: 0, prev: 0 }), { value: 12.5, note: null });
});

test("number box: while typing, only a complete number inside the range takes effect", () => {
  assert.equal(liveNumber("", { min: 0 }), null);
  assert.equal(liveNumber("-", { min: 0 }), null);
  assert.equal(liveNumber("-5", { min: 0 }), null);
  assert.equal(liveNumber("3", { min: 1000, max: 500000 }), null); // on the way to 300000: not pulled into the range
  assert.equal(liveNumber("300000", { min: 1000, max: 500000 }), 300000);
  assert.equal(liveNumber("12.", { min: 0 }), null);
});

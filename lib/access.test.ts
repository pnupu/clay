import assert from "node:assert/strict";
import { test } from "node:test";
import { COOKIE, cookieValue, hasAccess, isKey } from "./access.ts";
import { spend } from "./store.ts";

const KEY = "k".repeat(43);

test("access: bearer key or owner cookie, nothing else", () => {
  assert.equal(hasAccess({ authorization: `Bearer ${KEY}` }, KEY, true), true);
  assert.equal(hasAccess({ authorization: `bearer ${KEY}` }, KEY, true), true);
  assert.equal(hasAccess({ cookie: `a=b; ${COOKIE}=${cookieValue(KEY)}` }, KEY, true), true);
  assert.equal(hasAccess({}, KEY, true), false);
  assert.equal(hasAccess({ authorization: `Bearer ${KEY}x` }, KEY, true), false);
  assert.equal(hasAccess({ authorization: KEY }, KEY, true), false);
  // The cookie holds a derived value: the raw key in the cookie, or the cookie value as a bearer token, is refused.
  assert.equal(hasAccess({ cookie: `${COOKIE}=${KEY}` }, KEY, true), false);
  assert.equal(hasAccess({ authorization: `Bearer ${cookieValue(KEY)}` }, KEY, true), false);
});

test("access: no key is open only on a local machine; a short key matches nothing", () => {
  assert.equal(hasAccess({}, undefined, false), true);
  assert.equal(hasAccess({}, undefined, true), false);
  assert.equal(hasAccess({ authorization: "Bearer short" }, "short", false), false);
  assert.equal(isKey(KEY, KEY), true);
  assert.equal(isKey("", ""), false);
  assert.equal(isKey(undefined, KEY), false);
});

test("budget: counts per UTC day and stops at the cap", () => {
  assert.deepEqual(spend(null, "2026-11-13", 2), { day: "2026-11-13", used: 1 });
  assert.deepEqual(spend({ day: "2026-11-13", used: 1 }, "2026-11-13", 2), { day: "2026-11-13", used: 2 });
  assert.equal(spend({ day: "2026-11-13", used: 2 }, "2026-11-13", 2), null);
  assert.deepEqual(spend({ day: "2026-11-13", used: 2 }, "2026-11-14", 2), { day: "2026-11-14", used: 1 });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { KEY_PLACEHOLDER, maskKey } from "./mask.ts";

test("a hidden key shows its prefix and its last four characters, never the middle", () => {
  const key = "sorvi_0123456789abcdefghijklmnopqrstuvwxyzABCDa1b2";
  assert.equal(maskKey(key), "sorvi_••••••••••••a1b2");
  // The same length of dots for every key: the mask does not tell how long the key is.
  assert.equal(maskKey("sorvi_" + "x".repeat(90) + "9zZ0"), "sorvi_••••••••••••9zZ0");
  // A key made before the rename has the prefix "clay_": it is masked the same way.
  assert.equal(maskKey("clay_0123456789abcdefghijklmnopqrstuvwxyzABCDa1b2"), "clay_••••••••••••a1b2");
  // Nothing of the middle is in the masked text.
  for (let i = 6; i < key.length - 4; i += 4) assert.ok(!maskKey(key).includes(key.slice(i, i + 4)), key.slice(i, i + 4));
});

test("short keys show nothing of themselves; a key without a prefix shows no prefix; the placeholder stays", () => {
  // Fewer than 16 secret characters: the last four would be too large a part.
  assert.equal(maskKey("sorvi_short1234"), "sorvi_••••••••••••");
  assert.equal(maskKey("abcd"), "••••••••••••");
  assert.equal(maskKey("x"), "••••••••••••");
  // No underscore, or one that is far inside the key: no prefix is shown.
  assert.equal(maskKey("0123456789abcdefghijklmnop"), "••••••••••••mnop");
  assert.equal(maskKey("0123456789abcdef_ghijklmnopqrstuv"), "••••••••••••stuv");
  // An underscore near the start of a secret is not a prefix: nothing before it is shown.
  assert.equal(maskKey("aB3_xYz90123456789abcdefgh"), "••••••••••••efgh");
  assert.equal(maskKey("abc_0123456789abcdefgh"), "••••••••••••efgh");
  // The owner key of a local server ("local-owner-...") has no underscore either.
  assert.equal(maskKey("local-owner-0123456789abcdef0123"), "••••••••••••0123");
  assert.equal(maskKey(KEY_PLACEHOLDER), "<your agent key>");
  assert.equal(maskKey(""), "");
});

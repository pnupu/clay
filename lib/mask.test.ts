import assert from "node:assert/strict";
import { test } from "node:test";
import { KEY_PLACEHOLDER, maskKey } from "./mask.ts";

test("a hidden key shows its prefix and its last four characters, never the middle", () => {
  const key = "clay_0123456789abcdefghijklmnopqrstuvwxyzABCDa1b2";
  assert.equal(maskKey(key), "clay_••••••••••••a1b2");
  // The same length of dots for every key: the mask does not tell how long the key is.
  assert.equal(maskKey("clay_" + "x".repeat(90) + "9zZ0"), "clay_••••••••••••9zZ0");
  // Nothing of the middle is in the masked text.
  for (let i = 5; i < key.length - 4; i += 4) assert.ok(!maskKey(key).includes(key.slice(i, i + 4)), key.slice(i, i + 4));
});

test("short keys show nothing of themselves; a key without a prefix shows no prefix; the placeholder stays", () => {
  // Fewer than 16 secret characters: the last four would be too large a part.
  assert.equal(maskKey("clay_short1234"), "clay_••••••••••••");
  assert.equal(maskKey("abcd"), "••••••••••••");
  assert.equal(maskKey("x"), "••••••••••••");
  // No underscore, or one that is far inside the key: no prefix is shown.
  assert.equal(maskKey("0123456789abcdefghijklmnop"), "••••••••••••mnop");
  assert.equal(maskKey("0123456789abcdef_ghijklmnopqrstuv"), "••••••••••••stuv");
  // The owner key of a local server ("local-owner-...") has no underscore either.
  assert.equal(maskKey("local-owner-0123456789abcdef0123"), "••••••••••••0123");
  assert.equal(maskKey(KEY_PLACEHOLDER), "<your agent key>");
  assert.equal(maskKey(""), "");
});

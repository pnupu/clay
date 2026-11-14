// How a secret is shown on a page that may be on a shared screen: its prefix and its last four characters, with the
// middle replaced. The masked text is what goes into the page; the real value stays in memory for Copy.

/** The text that stands for "no key yet" in a command. It is not a secret and is shown as it is. */
export const KEY_PLACEHOLDER = "<your agent key>";
const DOTS = "••••••••••••";

/**
 * A key as it is shown while hidden: "sorvi_••••••••••••a1b2". Only the known prefix of an agent key ("sorvi_", or the earlier "clay_"; the kind of
 * key, not a secret) is shown: an underscore elsewhere is a normal character of a secret. The last four characters show
 * only when at least twelve more stay hidden; a shorter key shows nothing of itself. The placeholder and an empty text
 * are returned as they are.
 */
const PREFIXES = ["sorvi_", "clay_"];
export function maskKey(key: string): string {
  if (!key || key === KEY_PLACEHOLDER) return key;
  const prefix = PREFIXES.find((p) => key.startsWith(p)) ?? "";
  const secret = key.slice(prefix.length);
  return `${prefix}${DOTS}${secret.length >= 16 ? secret.slice(-4) : ""}`;
}

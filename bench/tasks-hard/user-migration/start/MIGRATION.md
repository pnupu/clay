# User store migration: v1 to v2

Input: a JSON array of user records. Output: a JSON array of v2 records, sorted by `id` ascending,
written with `json.dump(..., ensure_ascii=False, indent=2)` and a trailing newline.

A v1 record has `id` (int), `name`, `email`, `phone` (string or null), `created` and `prefs` (string).
A record that already has `"schema": 2` is a v2 record: it is not converted again, but it takes part
in duplicate merging (rule 6).

A v2 record has exactly these keys, in this order:
`schema` (always 2), `id`, `given_name`, `family_name`, `email`, `phone`, `created_at`, `prefs`.

1. **Name.** Trim and collapse runs of whitespace to one space. If the name contains a comma, it is
   `Family, Given`: the family name is the part before the first comma and the given name is the part
   after it, both trimmed. Otherwise split on spaces: one word is a given name with family name `""`;
   with more words, the family name is the last word and the given name is the other words. In that
   case, the lowercase particles `van`, `von`, `de` and `af` directly before the last word belong to
   the family name: `Ludwig van Beethoven` has given name `Ludwig` and family name `van Beethoven`.
2. **Email.** Trimmed and lowercased.
3. **Phone.** Remove spaces, `-`, `(` and `)`. Then: a number that starts with `+` is kept; one that
   starts with `00` gets `+` instead of `00`; one that starts with a single `0` is Finnish and gets `+358`
   instead of the `0`. Any other number, a result with fewer than 8 digits, a result that has
   characters other than a leading `+` and digits, an empty string and `null` all become `null`.
4. **Created.** `created` is one of: an integer (Unix seconds, UTC); an ISO 8601 string with `Z` or a
   UTC offset (`2026-03-01T10:00:00+02:00`); or `D.M.YYYY HH:MM` or `D.M.YYYY` (00:00) in Finnish local
   time (Europe/Helsinki, which observes daylight saving time). `created_at` is that moment in UTC as
   `YYYY-MM-DDTHH:MM:SSZ`. Local times in the data are never in a daylight saving gap or overlap.
5. **Prefs.** A comma-separated string: split on commas, trim and lowercase each item, drop empty
   items and repeats (keeping the first occurrence). The result is a list.
6. **Duplicates.** Records with the same non-empty email (after rule 2) are one user. For this
   comparison only, `googlemail.com` counts as `gmail.com`, and for those two domains dots in the part
   before `@` and anything from a `+` on are ignored (`a.b+x@googlemail.com` is the same user as
   `ab@gmail.com`). Each record still keeps its own email from rule 2. Keep the record
   with the latest `created_at`; if two have the same `created_at`, keep the one with the higher `id`.
   The kept record's `prefs` are its own prefs followed by the prefs of the other records of that
   user, taken in ascending `id` order, without repeats. Records with an empty email are never merged.

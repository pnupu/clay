# audit-export

`node export.js [--user <name>] [--until <date>]` prints the audit log (entries.json) as CSV:
`time,user,action`, oldest first.

The account's time zone is set in config.json as `timezone_offset_minutes` (minutes east of UTC).
All dates given on the command line are calendar dates (`YYYY-MM-DD`) in the account's time zone, and
a date filter always covers whole days in that time zone. Times in the output are also shown in the
account's time zone (`YYYY-MM-DD HH:MM`). An invalid date prints `invalid date: <value>` to stderr
and exits with status 2.

- `--user <name>`: only that user's entries.
- `--until <date>`: only entries up to and including that whole day.

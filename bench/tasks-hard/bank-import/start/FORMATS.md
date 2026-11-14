# Bank export formats

Every file is UTF-8, possibly with a byte-order mark, with LF or CRLF line endings. Blank lines are
ignored everywhere. Fields may be quoted with `"` (a quote inside a quoted field is doubled, `""`), and
a quoted field may contain the delimiter or a line break. `description` is the field's text with
leading and trailing whitespace removed and every run of whitespace (including line breaks) replaced
by one space. Amounts are converted to integer cents exactly (no floating point rounding);
negative amounts are money out.

## Pohjola Pankki (`bank`: "pohjola")

- First line is exactly `Kirjauspäivä;Määrä;Saaja/Maksaja;Viesti`, or, in exports made since
  October 2026, `Kirjauspäivä;Arvopäivä;Määrä;Saaja/Maksaja;Viesti` (with a value-date column; the
  transaction date is still the booking date).
- Delimiter `;`. Columns: booking date, (value date,) amount, counterparty, message.
- Date `D.M.YYYY` (day and month may have one or two digits).
- Amount uses a decimal comma, optional `.` thousands separators and a leading `+` or `-`:
  `-1.234,50`, `+12,00`, `7,5` (= 7.50).
- `description` is the counterparty, then ` / `, then the message; if the message is empty, just the
  counterparty.

## Nordea (`bank`: "nordea")

- First line is exactly `Date,Amount,Description,Balance`.
- Delimiter `,`. Date `MM/DD/YYYY`. Amount uses a decimal point and optional `,` thousands separators;
  a negative amount is written in parentheses: `(1,234.50)`. An amount may end with a space and the
  currency code `EUR` (`12.50 EUR`, `(3.00) EUR`); only EUR accounts are exported. Balance is ignored.
- The last lines of the file may be a footer that starts with `Total` or `Balance`: ignore those lines.

## S-Pankki (`bank`: "spankki")

- First line starts with `S-Pankki tiliote` (the rest of the line is the account and period).
  The second line is exactly `Päivä;Selite;Summa`.
- Delimiter `;`. Date `YYYYMMDD`.
- Amount uses a decimal comma and may group thousands with a space or a no-break space (U+00A0):
  `1 234,50`. A negative amount has a trailing minus: `12,30-`. Amounts have at most two decimals.
- Lines that start with `Saldo` are balance lines: ignore them.

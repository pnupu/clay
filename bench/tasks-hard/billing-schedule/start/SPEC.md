# Billing dates

`billing_dates(start, count, interval="monthly", holidays=(), pauses=())` returns the next `count`
billing dates of a subscription as a list of `datetime.date`, in increasing order.

- `start`: `datetime.date`, the first nominal billing date. Its day of month is the **anchor day**.
- `interval`: `"monthly"` or `"yearly"`. Anything else raises `ValueError`.
- `count`: number of dates to return. `0` returns `[]`; a negative count raises `ValueError`.
- `holidays`: iterable of `datetime.date` that are not business days.
- `pauses`: iterable of `(first, last)` pairs of `datetime.date`, both inclusive.

## Rules

1. **Nominal dates.** Nominal date *k* (k = 0, 1, 2, ...) is in the month that is *k* months
   (monthly) or *k* years (yearly) after `start`'s month. Its day is the anchor day, or the last day
   of that month if the month is shorter. If `start` is the last day of its month, the subscription
   is an **end-of-month** subscription: every nominal date is the last day of its month (a
   subscription that starts on 30 April bills on 31 May and 30 June). Nominal dates are always computed from `start` and the
   anchor day, never from an earlier billing date. So a subscription that starts on 31 January bills
   at the end of February and again on 31 March; one that starts on 29 February 2028 bills on
   28 February in years that are not leap years.
2. **Business-day adjustment (modified following).** Business days are Monday to Friday, except the
   `holidays`. If a nominal date is not a business day, the billing date is the next business day
   after it, unless that day is in a later month than the nominal date; then the billing date is the
   last business day before the nominal date. The adjusted date can therefore be earlier than the
   nominal date, and the first billing date can be earlier than `start`.
3. **Pauses.** A billing date (after adjustment) that falls inside any pause is skipped. A skipped
   billing date is not returned and does not count towards `count`; the schedule continues with the
   next nominal date until `count` dates are returned.

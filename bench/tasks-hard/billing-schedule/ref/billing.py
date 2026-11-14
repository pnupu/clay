import calendar
from datetime import date, timedelta


def _nominal(start, k, interval):
    months = k if interval == "monthly" else 12 * k
    y, m = divmod(start.month - 1 + months, 12)
    y += start.year
    m += 1
    last = calendar.monthrange(y, m)[1]
    if start.day == calendar.monthrange(start.year, start.month)[1]:
        return date(y, m, last)
    return date(y, m, min(start.day, last))


def billing_dates(start, count, interval="monthly", holidays=(), pauses=()):
    if interval not in ("monthly", "yearly"):
        raise ValueError(interval)
    if count < 0:
        raise ValueError(count)
    hol = set(holidays)
    pauses = list(pauses)
    business = lambda d: d.weekday() < 5 and d not in hol
    out, k = [], 0
    while len(out) < count:
        n = _nominal(start, k, interval)
        k += 1
        d = n
        while not business(d):
            d += timedelta(days=1)
        if d.month != n.month or d.year != n.year:
            d = n
            while not business(d):
                d -= timedelta(days=1)
        if any(a <= d <= b for a, b in pauses):
            continue
        out.append(d)
    return out

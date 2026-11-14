import calendar, random, sys
from datetime import date, timedelta
sys.path.insert(0, sys.argv[1])
from billing import billing_dates


def ref(start, count, interval="monthly", holidays=(), pauses=()):
    if interval not in ("monthly", "yearly") or count < 0:
        raise ValueError
    hol, pauses, out, k = set(holidays), list(pauses), [], 0
    bus = lambda d: d.weekday() < 5 and d not in hol
    while len(out) < count:
        months = k if interval == "monthly" else 12 * k
        y, m = divmod(start.month - 1 + months, 12); y += start.year; m += 1
        last = calendar.monthrange(y, m)[1]
        eom = start.day == calendar.monthrange(start.year, start.month)[1]
        n = date(y, m, last if eom else min(start.day, last)); k += 1
        d = n
        while not bus(d): d += timedelta(days=1)
        if (d.year, d.month) != (n.year, n.month):
            d = n
            while not bus(d): d -= timedelta(days=1)
        if not any(a <= d <= b for a, b in pauses):
            out.append(d)
    return out


def same(args, kw=None):
    kw = kw or {}
    want = ref(*args, **kw)
    got = billing_dates(*args, **kw)
    if list(got) != want:
        print(f"FAIL wrong-output: billing_dates{args} {kw}: got {got}, want {want}")
        sys.exit(1)


D = date
fi = [D(2026, 1, 1), D(2026, 1, 6), D(2026, 4, 3), D(2026, 4, 6), D(2026, 5, 1), D(2026, 5, 14), D(2026, 6, 19),
      D(2026, 12, 24), D(2026, 12, 25), D(2026, 12, 31), D(2027, 1, 1), D(2027, 4, 30), D(2027, 12, 31)]
same((D(2026, 1, 31), 14))
same((D(2026, 1, 30), 14))
same((D(2028, 2, 29), 6, "yearly"))
same((D(2026, 10, 31), 4))
same((D(2026, 5, 31), 3))
same((D(2026, 4, 30), 4))
same((D(2026, 2, 28), 4))
same((D(2028, 2, 28), 3, "yearly"))
same((D(2027, 2, 28), 3, "yearly"))
same((D(2026, 6, 30), 8), {"holidays": fi})
same((D(2026, 12, 25), 3), {"holidays": fi})
same((D(2026, 1, 31), 12), {"holidays": fi})
same((D(2026, 7, 31), 6), {"holidays": [D(2026, 7, 31), D(2026, 7, 30)]})
same((D(2026, 2, 28), 5), {"pauses": [(D(2026, 3, 27), D(2026, 5, 29))]})
same((D(2026, 1, 15), 4), {"pauses": [(D(2026, 2, 16), D(2026, 2, 16))]})
same((D(2026, 1, 31), 6), {"pauses": [(D(2026, 2, 27), D(2026, 2, 27)), (D(2026, 4, 30), D(2026, 6, 30))]})
same((D(2026, 3, 1), 3, "yearly"), {"holidays": fi})
rnd = random.Random(2026)
for _ in range(400):
    s = D(2025, 1, 1) + timedelta(days=rnd.randrange(0, 1500))
    hol = [D(2025, 1, 1) + timedelta(days=rnd.randrange(0, 2500)) for _ in range(rnd.randrange(0, 60))]
    ps = []
    for _ in range(rnd.randrange(0, 3)):
        a = s + timedelta(days=rnd.randrange(-20, 400))
        ps.append((a, a + timedelta(days=rnd.randrange(0, 90))))
    same((s, rnd.randrange(0, 13), rnd.choice(["monthly", "monthly", "yearly"])), {"holidays": hol, "pauses": ps})
# holidays and pauses may be any iterable, including one-shot iterators.
want = ref(D(2026, 1, 1), 3, holidays=fi, pauses=[(D(2026, 1, 1), D(2026, 1, 2))])
got = billing_dates(D(2026, 1, 1), 3, holidays=iter(fi), pauses=iter([(D(2026, 1, 1), D(2026, 1, 2))]))
if list(got) != want:
    print(f"FAIL wrong-output: holidays/pauses given as iterators: got {got}, want {want}"); sys.exit(1)
for bad in [((D(2026, 1, 1), -1), {}), ((D(2026, 1, 1), 2, "weekly"), {})]:
    try:
        billing_dates(*bad[0], **bad[1])
        print(f"FAIL wrong-output: billing_dates{bad[0]} should raise ValueError"); sys.exit(1)
    except ValueError:
        pass
print("pass")

from datetime import datetime, timedelta

_MON = {n: i + 1 for i, n in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}
_DOW = {n: i for i, n in enumerate("SUN MON TUE WED THU FRI SAT".split())}


def _num(tok, names):
    t = tok.upper()
    if t in names:
        return names[t]
    if not t.isascii() or not t.isdigit():
        raise ValueError(tok)
    return int(t)


def _field(spec, lo, hi, names=None):
    names = names or {}
    out = set()
    for part in spec.split(","):
        step, has_step = 1, "/" in part
        if has_step:
            part, s = part.split("/", 1)
            if not s.isascii() or not s.isdigit() or int(s) == 0:
                raise ValueError(spec)
            step = int(s)
        if part == "*":
            a, b = lo, hi
        elif "-" in part:
            x, y = part.split("-", 1)
            a, b = _num(x, names), _num(y, names)
        else:
            a = _num(part, names)
            b = hi if has_step else a
        if a < lo or b > hi or a > b:
            raise ValueError(spec)
        out.update(range(a, b + 1, step))
    return out


def next_run(expr, after):
    f = expr.split()
    if len(f) != 5:
        raise ValueError(expr)
    mins = _field(f[0], 0, 59)
    hours = _field(f[1], 0, 23)
    doms = _field(f[2], 1, 31)
    mons = _field(f[3], 1, 12, _MON)
    dows = {d % 7 for d in _field(f[4], 0, 7, _DOW)}
    dom_star, dow_star = f[2].startswith("*"), f[4].startswith("*")
    t = after.replace(second=0, microsecond=0) + timedelta(minutes=1)
    end = after + timedelta(days=366 * 8)
    while t <= end:
        if t.month not in mons:
            t = (t.replace(day=1, hour=0, minute=0) + timedelta(days=32)).replace(day=1)
            continue
        dom_ok, dow_ok = t.day in doms, (t.isoweekday() % 7) in dows
        day_ok = (dom_ok and dow_ok) if (dom_star or dow_star) else (dom_ok or dow_ok)
        if not day_ok:
            t = t.replace(hour=0, minute=0) + timedelta(days=1)
            continue
        if t.hour not in hours:
            t = t.replace(minute=0) + timedelta(hours=1)
            continue
        if t.minute not in mins:
            t += timedelta(minutes=1)
            continue
        return t
    raise ValueError("no run time found: " + expr)

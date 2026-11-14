import re
_RE = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-((?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$")

def is_valid(version):
    return isinstance(version, str) and _RE.fullmatch(version) is not None and "\n" not in version

def _parse(v):
    if not is_valid(v):
        raise ValueError(v)
    m = _RE.fullmatch(v)
    return [int(m.group(i)) for i in (1, 2, 3)], (m.group(4).split(".") if m.group(4) else None)

def _cmp(x, y):
    return (x > y) - (x < y)

def compare(a, b):
    (ca, pa), (cb, pb) = _parse(a), _parse(b)
    if ca != cb:
        return _cmp(ca, cb)
    if pa is None or pb is None:
        return _cmp(pa is None, pb is None)
    for x, y in zip(pa, pb):
        xn, yn = x.isdigit(), y.isdigit()
        if xn and yn:
            r = _cmp(int(x), int(y))
        elif xn != yn:
            r = -1 if xn else 1
        else:
            r = _cmp(x, y)
        if r:
            return r
    return _cmp(len(pa), len(pb))

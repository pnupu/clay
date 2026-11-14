from datetime import date, datetime
from decimal import Decimal
from xml.sax.saxutils import escape


def _select(row, columns):
    return [(c, row.get(c)) for c in columns]


def _fmt_value(v):
    if v is None:
        return None
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, datetime):
        return v.isoformat(timespec="seconds")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return f"{v:.2f}"
    if isinstance(v, float):
        return f"{v:.2f}"
    return str(v)


def _sort_rows(rows, key):
    present = [r for r in rows if r.get(key) is not None]
    missing = [r for r in rows if r.get(key) is None]

    def k(r):
        v = r[key]
        return v.lower() if isinstance(v, str) else v

    return sorted(present, key=k) + missing


def export_xml(rows, columns, sort_by=None, root="rows", item="row"):
    """<rows><row><col>value</col>...</row></rows>; a missing value omits its element."""
    if sort_by:
        rows = _sort_rows(rows, sort_by)
    parts = [f"<{root}>"]
    for r in rows:
        parts.append(f"  <{item}>")
        for c, v in _select(r, columns):
            s = _fmt_value(v)
            if s is not None:
                parts.append(f"    <{c}>{escape(s)}</{c}>")
        parts.append(f"  </{item}>")
    parts.append(f"</{root}>")
    return "\n".join(parts) + "\n"

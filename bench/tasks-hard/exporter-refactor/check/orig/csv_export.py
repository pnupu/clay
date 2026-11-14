import csv
import io
from datetime import date, datetime
from decimal import Decimal


def _select(row, columns):
    return [row.get(c) for c in columns]


def _fmt_value(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return f"{v:.2f}"
    if isinstance(v, float):
        return f"{v:.2f}"
    return str(v).strip()


def _sort_rows(rows, key):
    present = [r for r in rows if r.get(key) is not None]
    missing = [r for r in rows if r.get(key) is None]
    return sorted(present, key=lambda r: r[key]) + missing


def export_csv(rows, columns, sort_by=None):
    """CSV with a header row, one line per row, LF line endings."""
    if sort_by:
        rows = _sort_rows(rows, sort_by)
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(columns)
    for r in rows:
        w.writerow([_fmt_value(v) for v in _select(r, columns)])
    return buf.getvalue()

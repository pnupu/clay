import json
from datetime import date, datetime
from decimal import Decimal


def _select(row, columns):
    return {c: row[c] for c in columns if c in row}


def _fmt_value(v):
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%dT%H:%M:%S")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, float):
        return round(v, 2)
    if isinstance(v, int):
        return v
    return str(v).strip()


def _sort_rows(rows, key):
    present = [r for r in rows if r.get(key) is not None]
    missing = [r for r in rows if r.get(key) is None]
    return sorted(present, key=lambda r: r[key]) + missing


def export_json(rows, columns, sort_by=None):
    """A JSON array of objects with the given columns, 2-space indent, trailing newline."""
    if sort_by:
        rows = _sort_rows(rows, sort_by)
    out = [{k: _fmt_value(v) for k, v in _select(r, columns).items()} for r in rows]
    return json.dumps(out, ensure_ascii=False, indent=2) + "\n"

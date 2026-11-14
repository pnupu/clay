from datetime import date, datetime
from decimal import Decimal

STYLES = {
    "csv": {"none": "", "bool": ("yes", "no"), "datetime": lambda v: v.strftime("%Y-%m-%d %H:%M"),
            "decimal": lambda v: f"{v:.2f}", "float": lambda v: f"{v:.2f}", "int": None},
    "json": {"none": None, "bool": None, "datetime": lambda v: v.strftime("%Y-%m-%dT%H:%M:%S"),
             "decimal": float, "float": lambda v: round(v, 2), "int": lambda v: v},
    "xml": {"none": None, "bool": ("true", "false"), "datetime": lambda v: v.isoformat(timespec="seconds"),
            "decimal": lambda v: f"{v:.2f}", "float": lambda v: f"{v:.2f}", "int": None, "strip": False},
}


def select(row, columns, skip_absent=False):
    return [(c, row.get(c)) for c in columns if not skip_absent or c in row]


def fmt_value(v, style):
    s = STYLES[style]
    if v is None:
        return s["none"]
    if isinstance(v, bool):
        return v if s["bool"] is None else (s["bool"][0] if v else s["bool"][1])
    if isinstance(v, datetime):
        return s["datetime"](v)
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return s["decimal"](v)
    if isinstance(v, float):
        return s["float"](v)
    if isinstance(v, int) and s["int"] is not None:
        return s["int"](v)
    return str(v).strip() if s.get("strip", True) else str(v)


def sort_rows(rows, key, fold_case=False):
    present = [r for r in rows if r.get(key) is not None]
    missing = [r for r in rows if r.get(key) is None]

    def k(r):
        v = r[key]
        return v.lower() if fold_case and isinstance(v, str) else v

    return sorted(present, key=k) + missing

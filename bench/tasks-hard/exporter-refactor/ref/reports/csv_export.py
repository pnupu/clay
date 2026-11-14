import csv
import io

from .rows import fmt_value, select, sort_rows


def export_csv(rows, columns, sort_by=None):
    """CSV with a header row, one line per row, LF line endings."""
    if sort_by:
        rows = sort_rows(rows, sort_by)
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(columns)
    for r in rows:
        w.writerow([fmt_value(v, "csv") for _, v in select(r, columns)])
    return buf.getvalue()

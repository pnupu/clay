import json

from .rows import fmt_value, select, sort_rows


def export_json(rows, columns, sort_by=None):
    """A JSON array of objects with the given columns, 2-space indent, trailing newline."""
    if sort_by:
        rows = sort_rows(rows, sort_by)
    out = [{c: fmt_value(v, "json") for c, v in select(r, columns, skip_absent=True)} for r in rows]
    return json.dumps(out, ensure_ascii=False, indent=2) + "\n"

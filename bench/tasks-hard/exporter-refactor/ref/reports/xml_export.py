from xml.sax.saxutils import escape

from .rows import fmt_value, select, sort_rows


def export_xml(rows, columns, sort_by=None, root="rows", item="row"):
    """<rows><row><col>value</col>...</row></rows>; a missing value omits its element."""
    if sort_by:
        rows = sort_rows(rows, sort_by, fold_case=True)
    parts = [f"<{root}>"]
    for r in rows:
        parts.append(f"  <{item}>")
        for c, v in select(r, columns):
            s = fmt_value(v, "xml")
            if s is not None:
                parts.append(f"    <{c}>{escape(s)}</{c}>")
        parts.append(f"  </{item}>")
    parts.append(f"</{root}>")
    return "\n".join(parts) + "\n"

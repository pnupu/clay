import ast, importlib, os, random, subprocess, sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

work = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, work)
sys.path.insert(0, here)
new = {n: importlib.import_module(f"reports.{n}_export") for n in ("csv", "json", "xml")}
old = {n: importlib.import_module(f"orig.{n}_export") for n in ("csv", "json", "xml")}

# Structure: the helpers live in reports/rows.py, and no exporter defines its own copy.
if not os.path.exists(os.path.join(work, "reports", "rows.py")):
    print("FAIL incomplete: reports/rows.py does not exist"); sys.exit(1)
for n in ("csv", "json", "xml"):
    tree = ast.parse(open(os.path.join(work, "reports", f"{n}_export.py")).read())
    defs = {x.name for x in ast.walk(tree) if isinstance(x, (ast.FunctionDef, ast.AsyncFunctionDef))}
    dup = defs & {"_select", "_fmt_value", "_sort_rows"}
    if dup:
        print(f"FAIL incomplete: {n}_export.py still defines {sorted(dup)}"); sys.exit(1)
    uses = any(isinstance(x, ast.ImportFrom) and ((x.module or "").split(".")[-1] == "rows"
                                                    or any(a.name == "rows" for a in x.names)) for x in ast.walk(tree)) or \
        any(isinstance(x, ast.Import) and any(a.name.split(".")[-1] == "rows" for a in x.names) for x in ast.walk(tree))
    if not uses:
        print(f"FAIL incomplete: {n}_export.py does not import reports.rows"); sys.exit(1)

rnd = random.Random(42)
words = ["alpha", "Beta", "gamma", "Delta", "  padded ", "a&b<c>", 'quote "x"', "comma, here", "line\nbreak",
         "ÄÖ ü", "日本", "", "Zeta", "zeta", "42"]


def value(kind):
    if rnd.random() < 0.15:
        return None
    return {
        "int": lambda: rnd.randrange(-50, 1000),
        "str": lambda: rnd.choice(words),
        "bool": lambda: rnd.random() < 0.5,
        "dec": lambda: Decimal(rnd.choice(["0", "1.5", "-2.345", "10", "3.14159", "-0.004", "1E+2", "7.125"])),
        "float": lambda: rnd.choice([0.0, 1.005, -2.5, 3.14159, 100.0, -0.001, 2.675]),
        "date": lambda: date(2026, 1, 1) + timedelta(days=rnd.randrange(0, 400)),
        "dt": lambda: datetime(2026, 1, 1, 0, 0) + timedelta(minutes=rnd.randrange(0, 600000), seconds=rnd.randrange(0, 60)),
        "dtz": lambda: datetime(2026, 3, 1, 12, 30, 15, tzinfo=timezone(timedelta(hours=2))),
    }[kind]()


kinds = ["int", "str", "bool", "dec", "float", "date", "dt", "dtz"]
for case in range(300):
    cols = rnd.sample(kinds, rnd.randrange(1, len(kinds) + 1))
    rows = [{c: value(c) for c in cols} for _ in range(rnd.randrange(0, 12))]
    if rnd.random() < 0.2 and rows:
        rows[0]["extra"] = "ignored"
    for r in rows:
        if rnd.random() < 0.15:
            r.pop(rnd.choice(cols), None)
    sort_by = rnd.choice([None] + [c for c in cols if c not in ("bool", "dtz")] + ["missing_col"])
    for n, fn in (("csv", "export_csv"), ("json", "export_json"), ("xml", "export_xml")):
        a = getattr(old[n], fn)([dict(r) for r in rows], cols, sort_by=sort_by)
        try:
            b = getattr(new[n], fn)([dict(r) for r in rows], cols, sort_by=sort_by)
        except Exception as e:
            print(f"FAIL broke-behaviour: {fn} raised {type(e).__name__}: {e} for columns {cols} sort_by={sort_by}"); sys.exit(1)
        if a != b:
            print(f"FAIL broke-behaviour: {fn} output changed for columns {cols} sort_by={sort_by}: {a[:200]!r} -> {b[:200]!r}")
            sys.exit(1)
a = old["xml"].export_xml([{"x": 1}], ["x"], root="items", item="item")
b = new["xml"].export_xml([{"x": 1}], ["x"], root="items", item="item")
if a != b:
    print("FAIL broke-behaviour: export_xml root/item arguments"); sys.exit(1)
r = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests"], cwd=work, capture_output=True, text=True, timeout=60)
if r.returncode != 0:
    print("FAIL broke-behaviour: visible tests fail"); sys.exit(1)
print("pass")

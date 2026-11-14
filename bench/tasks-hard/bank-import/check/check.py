import json, os, sys
work = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, work)
from import_statement import parse_statement
files = os.path.join(here, "files")
want = json.load(open(os.path.join(here, "expected.json"), encoding="utf-8"))
for name, exp in want.items():
    try:
        got = parse_statement(os.path.join(files, name + ".csv"))
    except Exception as e:
        print(f"FAIL wrong-output: {name}.csv raised {type(e).__name__}: {str(e)[:120]}"); sys.exit(1)
    got = [dict(t) for t in got]
    if got != exp:
        bad = next((i for i, (a, b) in enumerate(zip(got, exp)) if a != b), min(len(got), len(exp)))
        print(f"FAIL wrong-output: {name}.csv transaction {bad}: got {got[bad] if bad < len(got) else 'nothing'}, want {exp[bad] if bad < len(exp) else 'nothing'}")
        sys.exit(1)
    if any(type(t["amount_cents"]) is not int for t in got):
        print(f"FAIL wrong-output: {name}.csv amount_cents is not int"); sys.exit(1)
for name in ("unknown", "reordered"):
    try:
        parse_statement(os.path.join(files, name + ".csv"))
        print(f"FAIL wrong-output: {name}.csv should raise ValueError"); sys.exit(1)
    except ValueError:
        pass
    except Exception as e:
        print(f"FAIL wrong-output: {name}.csv raised {type(e).__name__}, want ValueError"); sys.exit(1)
print("pass")

import json, os, shutil, subprocess, sys, tempfile
work = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
ordered = lambda path: json.load(open(path, encoding="utf-8"), object_pairs_hook=lambda kv: [list(p) for p in kv])
tmp = tempfile.mkdtemp(prefix="mig-chk-")
try:
    for name in ("sample", "hidden"):
        src = os.path.join(here, f"{name}.json")
        out1, out2 = os.path.join(tmp, f"{name}-1.json"), os.path.join(tmp, f"{name}-2.json")
        r = subprocess.run([sys.executable, "migrate.py", src, out1], cwd=work, capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            print(f"FAIL wrong-output: migrate.py crashed on {name} input: {r.stderr.strip().splitlines()[-1][:200] if r.stderr.strip() else r.returncode}"); sys.exit(1)
        got, want = ordered(out1), ordered(os.path.join(here, f"expected-{name}.json"))
        if got != want:
            g = {dict(x)["id"]: x for x in got} if isinstance(got, list) else {}
            w = {dict(x)["id"]: x for x in want}
            bad = next((i for i in sorted(w) if g.get(i) != w[i]), None)
            if bad is None:
                print(f"FAIL wrong-output: {name}: extra or misordered records: ids {[dict(x)['id'] for x in got]}")
            else:
                print(f"FAIL wrong-output: {name}: record {bad}: got {dict(g[bad]) if bad in g else 'missing'}, want {dict(w[bad])}")
            sys.exit(1)
        r = subprocess.run([sys.executable, "migrate.py", out1, out2], cwd=work, capture_output=True, text=True, timeout=60)
        if r.returncode != 0 or ordered(out2) != got:
            print(f"FAIL wrong-output: running migrate.py again on its own {name} output changed it"); sys.exit(1)
    print("pass")
finally:
    shutil.rmtree(tmp, ignore_errors=True)

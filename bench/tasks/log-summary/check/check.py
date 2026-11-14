import json, os, subprocess, sys
work = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
want = {"total": 7, "skipped": 2, "by_status": {"200": 5, "304": 1, "500": 1}, "bytes": 2170,
        "top_paths": [["/a", 2], ["/b", 2], ["/c", 2]], "methods": {"GET": 5, "DELETE": 1, "PUT": 1}}
for log, exp in [(os.path.join(here, "access.log"), json.load(open(os.path.join(here, "expected.json")))),
                 (os.path.join(here, "hidden.log"), want)]:
    r = subprocess.run([sys.executable, "summarize.py", log], cwd=work, capture_output=True, text=True, timeout=30)
    got = json.loads(r.stdout)
    assert got == exp, (log, got, exp)
print("pass")

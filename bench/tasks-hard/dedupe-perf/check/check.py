import hashlib, os, shutil, subprocess, sys, tempfile, time
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
from gen import generate
work = sys.argv[1]
orig = os.path.join(here, "orig_dedupe.py")


def run(script, csvp, timeout):
    t = time.monotonic()
    r = subprocess.run([sys.executable, script, csvp], capture_output=True, text=True, timeout=timeout)
    return r, time.monotonic() - t


tmp = tempfile.mkdtemp(prefix="dedupe-chk-")
try:
    # Correctness on small inputs against the original quadratic job.
    for seed in range(1, 9):
        p = os.path.join(tmp, f"s{seed}.csv")
        generate(p, 300 + seed * 37, seed)
        want, _ = run(orig, p, 120)
        try:
            got, _ = run(os.path.join(work, "dedupe.py"), p, 30)
        except subprocess.TimeoutExpired:
            print("FAIL too-slow: a 600-row input took over 30 s"); sys.exit(1)
        if got.stdout != want.stdout:
            print(f"FAIL wrong-output: output differs from the original job on a {300 + seed * 37}-row input (seed {seed})"); sys.exit(1)
    # Speed and correctness on the large input; expected output hash made with the reference solution.
    big = os.path.join(tmp, "big.csv")
    generate(big, 150000, 99)
    try:
        got, secs = run(os.path.join(work, "dedupe.py"), big, 60)
    except subprocess.TimeoutExpired:
        print("FAIL too-slow: 150k-row input took over 60 s"); sys.exit(1)
    want = open(os.path.join(here, "big.sha256")).read().strip()
    if hashlib.sha256(got.stdout.encode()).hexdigest() != want:
        print(f"FAIL wrong-output: 150k-row output differs from the expected output ({len(got.stdout.splitlines())} groups)"); sys.exit(1)
    print(f"pass ({secs:.1f} s for 150k rows)")
finally:
    shutil.rmtree(tmp, ignore_errors=True)

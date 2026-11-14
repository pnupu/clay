#!/usr/bin/env python3
"""Usage: python3 bench/validate.py [task-set dir, default tasks]

Validate every task: the hidden check must FAIL on the starting state and PASS on the reference solution."""
import json, os, shutil, sys, tempfile

import run  # the same hidden-check runner as the benchmark

HERE = os.path.dirname(os.path.abspath(__file__))
TASKS = os.path.join(HERE, sys.argv[1] if len(sys.argv) > 1 else "tasks")


def run_check(task_dir, task, work):
    passed, out, _ = run.run_check(task_dir, task, work)
    return passed, out


def main():
    ok = True
    for tid in sorted(os.listdir(TASKS)):
        td = os.path.join(TASKS, tid)
        task = json.load(open(os.path.join(td, "task.json")))
        with tempfile.TemporaryDirectory(prefix="bench-val-") as w:
            shutil.copytree(os.path.join(td, "start"), w, dirs_exist_ok=True)
            start_pass, _ = run_check(td, task, w)
            shutil.copytree(os.path.join(td, "ref"), w, dirs_exist_ok=True)
            ref_pass, out = run_check(td, task, w)
        good = (not start_pass) and ref_pass
        ok &= good
        print(f"{'OK  ' if good else 'BAD '} {tid:18} start={'pass' if start_pass else 'fail'} ref={'pass' if ref_pass else 'fail'}"
              + ("" if ref_pass else f"\n     {out}"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()

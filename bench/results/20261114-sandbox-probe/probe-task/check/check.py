import os, sys
rep = open(os.path.join(sys.argv[1], "report.txt")).read()
print(rep)
bad = [l for l in rep.splitlines() if l.startswith("VISIBLE") or l == "WROTE outside"]
ok = rep.count("HIDDEN") == 8 and "BLOCKED outside" in rep and "NODE 42" in rep
print("pass" if ok and not bad else "FAIL wrong-output: " + "; ".join(bad))
sys.exit(0 if ok and not bad else 1)

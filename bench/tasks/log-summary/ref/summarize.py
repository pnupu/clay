import json, re, sys
from collections import Counter
LINE = re.compile(r'^(\S+) (\S+) (\S+) \[([^\]]+)\] "(\S+) (\S+) (\S+)" (\d{3}) (\d+|-) "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)"\s*$')
def main(p):
    total = skipped = nbytes = 0
    st, paths, methods = Counter(), Counter(), Counter()
    with open(p, encoding="utf-8", errors="replace") as f:
        for line in f:
            if not line.strip():
                continue
            m = LINE.match(line.rstrip("\r\n"))
            if not m:
                skipped += 1
                continue
            total += 1
            st[m.group(8)] += 1
            methods[m.group(5)] += 1
            paths[m.group(6).split("?", 1)[0]] += 1
            nbytes += 0 if m.group(9) == "-" else int(m.group(9))
    top = sorted(paths.items(), key=lambda kv: (-kv[1], kv[0]))[:3]
    print(json.dumps({"total": total, "skipped": skipped, "by_status": dict(st), "bytes": nbytes,
                      "top_paths": [list(t) for t in top], "methods": dict(methods)}))
main(sys.argv[1])

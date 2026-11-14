"""Find groups of customer records that are the same person.

Two records match if any of these is true:
  - their normalized emails are equal and not empty, and the email is not a shared role address
    (local part info, sales, support, noreply, no-reply, admin or office),
  - their normalized phones are equal and not empty,
  - their normalized names are equal and have at least two words AND their zip codes are equal and
    not empty.
Matching is transitive: if A matches B and B matches C, all three are one group.

Output: one line per group of 2 or more records, the record ids sorted ascending and joined by
commas; lines sorted by their first id. Ids are compared as integers.
"""
import csv
import sys
import unicodedata

ROLE_ACCOUNTS = {"info", "sales", "support", "noreply", "no-reply", "admin", "office"}


def norm_email(e):
    e = e.strip().lower()
    if "@" not in e:
        return ""
    local, domain = e.rsplit("@", 1)
    if domain in ("gmail.com", "googlemail.com"):
        local = local.split("+", 1)[0].replace(".", "")
        domain = "gmail.com"
    return f"{local}@{domain}" if local else ""


def norm_phone(p):
    digits = "".join(ch for ch in p if ch.isdigit())
    if digits.startswith("00358"):
        digits = "0" + digits[5:]
    elif digits.startswith("358") and p.strip().startswith("+"):
        digits = "0" + digits[3:]
    return digits if len(digits) >= 7 else ""


def norm_name(n):
    n = unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode().lower()
    return " ".join(n.split())


def load(path):
    with open(path, newline="", encoding="utf-8") as f:
        return [
            {"id": int(r["id"]), "email": norm_email(r["email"]), "phone": norm_phone(r["phone"]),
             "name": norm_name(r["name"]), "zip": r["zip"].strip()}
            for r in csv.DictReader(f)
        ]


def matches(a, b):
    if a["email"] and a["email"] == b["email"]:
        return True
    if a["phone"] and a["phone"] == b["phone"]:
        return True
    return bool(a["name"] and a["zip"] and a["name"] == b["name"] and a["zip"] == b["zip"])


def groups(recs):
    parent = list(range(len(recs)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    first = {}
    for i, r in enumerate(recs):
        keys = []
        if r["email"] and r["email"].split("@")[0] not in ROLE_ACCOUNTS:
            keys.append(("e", r["email"]))
        if r["phone"]:
            keys.append(("p", r["phone"]))
        if " " in r["name"] and r["zip"]:
            keys.append(("n", r["name"], r["zip"]))
        for k in keys:
            j = first.setdefault(k, i)
            a, b = find(i), find(j)
            if a != b:
                parent[a] = b
    comps = {}
    for i, r in enumerate(recs):
        comps.setdefault(find(i), []).append(r["id"])
    return sorted(sorted(c) for c in comps.values() if len(c) > 1)


def main(path):
    for g in groups(load(path)):
        print(",".join(map(str, g)))


if __name__ == "__main__":
    main(sys.argv[1])

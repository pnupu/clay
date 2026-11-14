import json
import re
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

HEL = ZoneInfo("Europe/Helsinki")
PARTICLES = {"van", "von", "de", "af"}
KEYS = ["schema", "id", "given_name", "family_name", "email", "phone", "created_at", "prefs"]


def split_name(name):
    name = " ".join(name.split())
    if "," in name:
        fam, given = name.split(",", 1)
        return given.strip(), fam.strip()
    w = name.split(" ") if name else []
    if len(w) == 0:
        return "", ""
    if len(w) == 1:
        return w[0], ""
    i = len(w) - 1
    while i > 1 and w[i - 1] in PARTICLES:
        i -= 1
    return " ".join(w[:i]), " ".join(w[i:])


def phone(p):
    if not p:
        return None
    s = re.sub(r"[ \-()]", "", p)
    if s.startswith("+"):
        pass
    elif s.startswith("00"):
        s = "+" + s[2:]
    elif s.startswith("0"):
        s = "+358" + s[1:]
    else:
        return None
    if not re.fullmatch(r"\+\d+", s) or len(s) - 1 < 8:
        return None
    return s


def created(c):
    if isinstance(c, int) and not isinstance(c, bool):
        dt = datetime.fromtimestamp(c, timezone.utc)
    else:
        m = re.fullmatch(r"(\d{1,2})\.(\d{1,2})\.(\d{4})(?: (\d{1,2}):(\d{2}))?", c.strip())
        if m:
            d, mo, y, hh, mm = m.groups()
            dt = datetime(int(y), int(mo), int(d), int(hh or 0), int(mm or 0), tzinfo=HEL)
        else:
            dt = datetime.fromisoformat(c.strip().replace("Z", "+00:00"))
            if dt.tzinfo is None:
                raise ValueError(f"no time zone: {c}")
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def prefs(s):
    out = []
    for p in s.split(","):
        p = p.strip().lower()
        if p and p not in out:
            out.append(p)
    return out


def convert(r):
    if r.get("schema") == 2:
        return {k: r[k] for k in KEYS}
    g, f = split_name(r["name"])
    return {"schema": 2, "id": r["id"], "given_name": g, "family_name": f, "email": r["email"].strip().lower(),
            "phone": phone(r.get("phone")), "created_at": created(r["created"]), "prefs": prefs(r.get("prefs") or "")}


def dup_key(email):
    local, _, domain = email.rpartition("@")
    if domain in ("gmail.com", "googlemail.com"):
        return local.split("+", 1)[0].replace(".", "") + "@gmail.com"
    return email


def migrate(records):
    recs = [convert(r) for r in records]
    by_email, out = {}, []
    for r in recs:
        if r["email"]:
            by_email.setdefault(dup_key(r["email"]), []).append(r)
        else:
            out.append(r)
    for group in by_email.values():
        keep = max(group, key=lambda r: (r["created_at"], r["id"]))
        merged = list(keep["prefs"])
        for o in sorted(group, key=lambda r: r["id"]):
            if o is keep:
                continue
            for p in o["prefs"]:
                if p not in merged:
                    merged.append(p)
        keep = dict(keep, prefs=merged)
        out.append(keep)
    return sorted(out, key=lambda r: r["id"])


if __name__ == "__main__":
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        json.dump(migrate(data), f, ensure_ascii=False, indent=2)
        f.write("\n")

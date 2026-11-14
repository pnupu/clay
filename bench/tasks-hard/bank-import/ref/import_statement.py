import csv
import io
import re
from datetime import date

POHJOLA = "Kirjauspäivä;Määrä;Saaja/Maksaja;Viesti"
POHJOLA_VALUE_DATE = "Kirjauspäivä;Arvopäivä;Määrä;Saaja/Maksaja;Viesti"
NORDEA = "Date,Amount,Description,Balance"
SPANKKI_HEAD = "Päivä;Selite;Summa"


def _desc(s):
    return " ".join(s.split())


def _cents(intpart, frac, neg):
    if not re.fullmatch(r"\d+", intpart) or not re.fullmatch(r"\d{0,2}", frac):
        raise ValueError(f"bad amount {intpart},{frac}")
    c = int(intpart) * 100 + int((frac + "00")[:2])
    return -c if neg else c


def _rows(text, delim):
    return [r for r in csv.reader(io.StringIO(text), delimiter=delim) if any(x.strip() for x in r)]


def parse_statement(path):
    raw = open(path, "rb").read().decode("utf-8")
    if raw.startswith("﻿"):
        raw = raw[1:]
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    first, _, rest = raw.partition("\n")
    out = []
    if first in (POHJOLA, POHJOLA_VALUE_DATE):
        for r in _rows(rest, ";"):
            if first == POHJOLA_VALUE_DATE:
                r = [r[0]] + r[2:]
            d, m, y = r[0].strip().split(".")
            a = r[1].strip()
            neg = a.startswith("-")
            a = a.lstrip("+-").replace(".", "")
            ip, _, fr = a.partition(",")
            cp, msg = _desc(r[2]), _desc(r[3]) if len(r) > 3 else ""
            out.append({"bank": "pohjola", "date": date(int(y), int(m), int(d)).isoformat(),
                        "amount_cents": _cents(ip, fr, neg), "description": f"{cp} / {msg}" if msg else cp})
    elif first == NORDEA:
        for r in _rows(rest, ","):
            if r[0].strip().startswith(("Total", "Balance")):
                continue
            mo, d, y = r[0].strip().split("/")
            a = r[1].strip()
            if a.endswith(" EUR"):
                a = a[:-4].strip()
            neg = a.startswith("(") and a.endswith(")")
            a = a.strip("()").replace(",", "")
            ip, _, fr = a.partition(".")
            out.append({"bank": "nordea", "date": date(int(y), int(mo), int(d)).isoformat(),
                        "amount_cents": _cents(ip, fr, neg), "description": _desc(r[2])})
    elif first.startswith("S-Pankki tiliote"):
        second, _, rest = rest.partition("\n")
        while second.strip() == "" and rest:
            second, _, rest = rest.partition("\n")
        if second != SPANKKI_HEAD:
            raise ValueError("not an S-Pankki export")
        for r in _rows(rest, ";"):
            if r[0].strip().startswith("Saldo"):
                continue
            s = r[0].strip()
            a = r[2].strip().replace(" ", "").replace(" ", "")
            neg = a.endswith("-")
            ip, _, fr = a.rstrip("-").partition(",")
            out.append({"bank": "spankki", "date": date(int(s[:4]), int(s[4:6]), int(s[6:8])).isoformat(),
                        "amount_cents": _cents(ip, fr, neg), "description": _desc(r[1])})
    else:
        raise ValueError("unknown statement format")
    return out

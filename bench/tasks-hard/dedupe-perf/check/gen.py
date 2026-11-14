import csv, random


def generate(path, n, seed):
    rnd = random.Random(seed)
    first = ["Matti", "Maija", "Anna", "Jussi", "Liisa", "Pekka", "Sanna", "Ville", "Åsa", "Jöns", "Élodie", "Kalle", "Noora"]
    last = ["Virtanen", "Korhonen", "Mäkinen", "Nieminen", "Lindström", "Ström", "Laine", "Heikkinen", "Koskinen"]
    domains = ["example.com", "gmail.com", "googlemail.com", "Mail.FI", "yritys.fi"]
    people = []
    for i in range(n // 3):
        fn, ln = rnd.choice(first), rnd.choice(last)
        local = f"{fn}.{ln}{rnd.randrange(10000)}".lower()
        people.append((fn, ln, local, rnd.choice(domains), f"040{rnd.randrange(10**7):07d}", f"{rnd.randrange(100, 999)}00"))
    ids = rnd.sample(range(1, n * 5), n)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "name", "email", "phone", "zip"])
        for rid in ids:
            fn, ln, local, dom, ph, z = rnd.choice(people)
            name = rnd.choice([f"{fn} {ln}", f"{fn.upper()}  {ln}", f" {fn} {ln} ", f"{fn} {ln}", fn, f" {ln} "])
            r = rnd.random()
            if r < 0.25:
                email = ""
            elif r < 0.35:
                email = "   "
            elif r < 0.45 and dom in ("gmail.com", "googlemail.com"):
                email = f"{local.replace('.', '')}+shop@{dom.upper()}"
            elif r < 0.5:
                email = "no-at-sign"
            elif r < 0.55:
                email = "@" + dom
            elif r < 0.62:
                email = rnd.choice(["info", "sales", "Support", "no-reply", "office", "info+x"]) + "@" + dom
            else:
                email = f"{local}{rnd.randrange(3)}@{dom}"
            p = rnd.random()
            if p < 0.3:
                phone = ""
            elif p < 0.4:
                phone = "+358 " + ph[1:3] + " " + ph[3:]
            elif p < 0.45:
                phone = "00358" + ph[1:]
            elif p < 0.5:
                phone = "123"
            elif p < 0.55:
                phone = "358" + ph[1:]
            else:
                phone = ph[:3] + "-" + ph[3:] if rnd.random() < 0.5 else ph
            if rnd.random() < 0.7:
                ph_noise = rnd.randrange(10)
                phone = phone[:-1] + str(ph_noise) if len(phone) > 7 else phone
            zz = rnd.choice([z, z, "", " " + z, str(int(z) + 1)])
            w.writerow([rid, name, email, phone, zz])

import os, re, subprocess, sys, warnings
work = sys.argv[1]
sys.path.insert(0, work)
from shipping import rates, cart, quote
assert callable(getattr(rates, "calculate_shipping", None)), "calculate_shipping missing"
assert rates.calculate_shipping(3, "eu", express=True) == 21.38
assert rates.calculate_shipping(2.5, "world") == 26.12
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter("always")
    assert rates.calc(3, "eu", express=True) == 21.38
    assert rates.calc(weight_kg=1, zone="domestic") == 4.0
    assert any(issubclass(x.category, DeprecationWarning) for x in w), "calc does not warn"
with warnings.catch_warnings():
    warnings.simplefilter("error", DeprecationWarning)
    assert cart.cart_total([(10.0, 0.5), (5.0, 0.5)], "domestic") == 19.0
    assert quote.quote_lines(1)[1] == "eu: 9.50 EUR"
    assert rates.calculate_shipping(1, "domestic") == 4.0
try:
    rates.calc(0, "eu")
    raise AssertionError("calc(0) should raise ValueError")
except ValueError:
    pass
for name in ("cart.py", "quote.py"):
    src = open(os.path.join(work, "shipping", name)).read()
    assert not re.search(r"\bcalc\b", src), f"{name} still uses calc"
r = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests"], cwd=work, capture_output=True, text=True, timeout=60)
assert r.returncode == 0, r.stderr[-2000:]
print("pass")

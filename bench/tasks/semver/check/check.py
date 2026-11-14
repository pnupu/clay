import sys
sys.path.insert(0, sys.argv[1])
from semver import is_valid, compare
valid = ["0.0.0", "1.2.3", "10.20.30", "1.1.2-prerelease+meta", "1.1.2+meta", "1.1.2+meta-valid",
         "1.0.0-alpha", "1.0.0-beta", "1.0.0-alpha.beta", "1.0.0-alpha.beta.1", "1.0.0-alpha.1",
         "1.0.0-alpha0.valid", "1.0.0-alpha.0valid", "1.0.0-rc.1+build.1", "2.0.0-rc.1+build.123",
         "1.2.3-beta", "10.2.3-DEV-SNAPSHOT", "1.2.3-SNAPSHOT-123", "2.0.0+build.1848", "2.0.1-alpha.1227",
         "1.0.0-alpha+beta", "1.2.3----RC-SNAPSHOT.12.9.1--.12+788", "1.2.3----R-S.12.9.1--.12+meta",
         "1.0.0+0.build.1-rc.10000aaa-kk-0.1", "1.0.0-0A.is.legal", "1.0.0-0abc", "1.0.0+001",
         "99999999999999999999999.999999999999999999.99999999999999999"]
invalid = ["1", "1.2", "1.2.3-0123", "1.2.3-0123.0123", "1.1.2+.123", "+invalid", "-invalid",
           "-invalid+invalid", "-invalid.01", "alpha", "alpha.beta", "alpha.beta.1", "1.0.0-alpha_beta",
           "1.0.0-alpha..", "1.0.0-alpha..1", "1.0.0-alpha...1", "01.1.1", "1.01.1", "1.1.01", "1.2.3.DEV",
           "1.2-SNAPSHOT", "1.2.31.2.3----RC-SNAPSHOT.12.09.1--..12+788", "+justmeta", "9.8.7+meta+meta",
           "9.8.7-whatever+meta+meta", "v1.2.3", "1.2.3-", "1.2.3+", " 1.2.3", "1.2.3 ", "1.2.3\n", "",
           "1.0.0-01", "1.2.3-a.b..c", "1.2.3+a..b", "1.2.3-é", "١.٢.٣"]
for v in valid:
    assert is_valid(v) is True, ("should be valid", v)
for v in invalid:
    assert is_valid(v) is False, ("should be invalid", v)
order = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2",
         "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1-0", "1.0.1-1", "1.0.1-1a", "1.0.1-Z", "1.0.1-a",
         "1.0.1", "1.2.0", "1.10.0", "2.0.0-9", "2.0.0-10", "2.0.0", "10.0.0"]
for i, a in enumerate(order):
    for j, b in enumerate(order):
        want = (i > j) - (i < j)
        assert compare(a, b) == want, (a, b, compare(a, b), want)
assert compare("1.0.0+a", "1.0.0+b") == 0
assert compare("1.0.0-rc.1+x", "1.0.0-rc.1") == 0
assert compare("1.0.0-alpha.1.2", "1.0.0-alpha.1") == 1
assert compare("1.0.0-2.a", "1.0.0-10.a") == -1
assert compare("1.0.0-x.7.z.92", "1.0.0-x.7.z.93") == -1
assert compare("99999999999999999999999.0.0", "99999999999999999999998.9.9") == 1
for bad in [("1.0", "1.0.0"), ("1.0.0", "01.0.0"), ("1.0.0-01", "1.0.0")]:
    try:
        compare(*bad)
        raise AssertionError(("expected ValueError", bad))
    except ValueError:
        pass
print("pass")

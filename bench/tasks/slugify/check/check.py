import sys
sys.path.insert(0, sys.argv[1])
from slug import slugify
cases = [
    (("Hello, World!",), "hello-world"),
    (("  --Already--slugged--  ",), "already-slugged"),
    (("Crème Brûlée: 10 tips",), "creme-brulee-10-tips"),
    (("日本語 title",), "title"),
    (("!!!",), ""),
    (("",), ""),
    (("a" * 70,), "a" * 60),
    (("hello world again", 11), "hello-world"),
    (("hello world again", 12), "hello-world"),
    (("Ünïcödé   Spaces\tand\nlines",), "unicode-spaces-and-lines"),
    (("C++ & Python_3.12",), "c-python-3-12"),
]
for args, want in cases:
    got = slugify(*args)
    assert got == want, (args, got, want)
print("pass")

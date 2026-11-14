import unittest
from semver import is_valid, compare


class SemverTest(unittest.TestCase):
    def test_valid(self):
        self.assertTrue(is_valid("1.2.3"))
        self.assertFalse(is_valid("1.2"))

    def test_compare(self):
        self.assertEqual(compare("1.0.0", "2.0.0"), -1)
        self.assertEqual(compare("1.0.0-alpha", "1.0.0"), -1)


if __name__ == "__main__":
    unittest.main()

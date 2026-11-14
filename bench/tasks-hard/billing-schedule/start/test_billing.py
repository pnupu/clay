import unittest
from datetime import date
from billing import billing_dates


class BillingTest(unittest.TestCase):
    def test_monthly_simple(self):
        self.assertEqual(billing_dates(date(2026, 1, 15), 3),
                         [date(2026, 1, 15), date(2026, 2, 16), date(2026, 3, 16)])

    def test_zero(self):
        self.assertEqual(billing_dates(date(2026, 1, 15), 0), [])


if __name__ == "__main__":
    unittest.main()

import unittest
from datetime import datetime
from cron import next_run


class CronTest(unittest.TestCase):
    def test_every_15(self):
        self.assertEqual(next_run("*/15 * * * *", datetime(2026, 1, 1, 10, 7)), datetime(2026, 1, 1, 10, 15))

    def test_daily(self):
        self.assertEqual(next_run("30 4 * * *", datetime(2026, 1, 1, 5, 0)), datetime(2026, 1, 2, 4, 30))


if __name__ == "__main__":
    unittest.main()

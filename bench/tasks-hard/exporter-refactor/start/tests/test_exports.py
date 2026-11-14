import sys, os, unittest
from datetime import date
from decimal import Decimal
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from reports.csv_export import export_csv
from reports.json_export import export_json
from reports.xml_export import export_xml

ROWS = [{"id": 2, "name": "Beta", "amount": Decimal("3.5"), "day": date(2026, 1, 2)},
        {"id": 1, "name": "alpha", "amount": Decimal("10"), "day": date(2026, 1, 1)}]


class ExportTest(unittest.TestCase):
    def test_csv(self):
        self.assertEqual(export_csv(ROWS, ["id", "name", "amount"], sort_by="id"),
                         "id,name,amount\n1,alpha,10.00\n2,Beta,3.50\n")

    def test_json(self):
        self.assertIn('"amount": 3.5', export_json(ROWS, ["id", "amount"]))

    def test_xml(self):
        self.assertIn("<day>2026-01-01</day>", export_xml(ROWS, ["day"]))


if __name__ == "__main__":
    unittest.main()

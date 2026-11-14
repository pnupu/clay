import unittest
from shipping.rates import calc
from shipping.cart import cart_total
from shipping.quote import quote_lines


class ShippingTest(unittest.TestCase):
    def test_calc(self):
        self.assertEqual(calc(1, "domestic"), 4.0)
        self.assertEqual(calc(3, "eu", express=True), 21.38)

    def test_cart(self):
        self.assertEqual(cart_total([(10.0, 0.5), (5.0, 0.5)], "domestic"), 19.0)

    def test_quote(self):
        self.assertEqual(quote_lines(1)[0], "domestic: 4.00 EUR")


if __name__ == "__main__":
    unittest.main()

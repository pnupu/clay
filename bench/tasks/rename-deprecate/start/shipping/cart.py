from .rates import calc


def cart_total(items, zone, express=False):
    """items: list of (price_eur, weight_kg)."""
    goods = sum(p for p, _ in items)
    weight = sum(w for _, w in items)
    return round(goods + calc(weight, zone, express=express), 2)

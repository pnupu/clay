import warnings

ZONE_RATES = {"domestic": 4.0, "eu": 9.5, "world": 19.0}


def calculate_shipping(weight_kg, zone, express=False):
    """Shipping price in EUR."""
    if weight_kg <= 0:
        raise ValueError("weight must be positive")
    base = ZONE_RATES[zone]
    price = base + max(0.0, weight_kg - 1) * base * 0.25
    if express:
        price *= 1.5
    return round(price, 2)


def calc(*args, **kwargs):
    warnings.warn("calc is deprecated; use calculate_shipping", DeprecationWarning, stacklevel=2)
    return calculate_shipping(*args, **kwargs)

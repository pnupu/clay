from . import rates


def quote_lines(weight_kg):
    return [f"{zone}: {rates.calc(weight_kg, zone):.2f} EUR" for zone in sorted(rates.ZONE_RATES)]

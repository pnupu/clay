from datetime import date


def billing_dates(start: date, count: int, interval: str = "monthly", holidays=(), pauses=()) -> list:
    raise NotImplementedError

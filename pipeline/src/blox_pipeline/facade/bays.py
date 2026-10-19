"""Window bay placement along a facade."""

from __future__ import annotations

WINDOW_W = 2


def bay_starts(x0: int, x1: int, window_w: int = WINDOW_W, min_pier: int = 1) -> list[int]:
    """Local i of each window's west edge, spread evenly between the corner pilasters.

    The pilasters occupy ``x0`` and ``x1 - 1``; windows keep at least ``min_pier`` studs of
    wall between each other and the pilasters.
    """
    inner0, inner1 = x0 + 1, x1 - 1
    span = inner1 - inner0
    n = max(1, (span - min_pier) // (window_w + min_pier))
    piers = span - n * window_w            # wall studs left over, n + 1 gaps
    gaps = [piers // (n + 1)] * (n + 1)
    middle_first = sorted(range(n + 1), key=lambda b: abs(b - n / 2))
    for b in middle_first[: piers - sum(gaps)]:  # remainder goes to the central gaps
        gaps[b] += 1
    starts, i = [], inner0
    for b in range(n):
        i += gaps[b]
        starts.append(i)
        i += window_w
    return starts

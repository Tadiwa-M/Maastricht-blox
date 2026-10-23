"""GTFS service calendars -> which services run on each day of one reference week.

The export keeps **one service-day pattern per weekday**: seven consecutive dates starting
at ``start`` (one Monday, one Tuesday, ...). A trip gets a 7-bit mask, bit ``w`` set when its
service runs on the reference date with ``date.weekday() == w`` (0 = Monday).
"""

from __future__ import annotations

import datetime as dt
import zipfile
from collections import defaultdict
from dataclasses import dataclass, field

from .csvzip import has_file, iter_rows

DAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def parse_date(text: str) -> dt.date:
    return dt.date(int(text[:4]), int(text[4:6]), int(text[6:8]))


@dataclass
class Calendar:
    """``calendar.txt`` rules plus ``calendar_dates.txt`` exceptions."""

    weekly: dict[str, tuple[tuple[bool, ...], dt.date, dt.date]] = field(default_factory=dict)
    added: dict[str, set[dt.date]] = field(default_factory=lambda: defaultdict(set))
    removed: dict[str, set[dt.date]] = field(default_factory=lambda: defaultdict(set))

    def runs(self, service_id: str, day: dt.date) -> bool:
        if day in self.removed.get(service_id, ()):
            return False
        if day in self.added.get(service_id, ()):
            return True
        rule = self.weekly.get(service_id)
        return bool(rule and rule[1] <= day <= rule[2] and rule[0][day.weekday()])

    def date_range(self) -> tuple[dt.date, dt.date] | None:
        days = [d for r in self.weekly.values() for d in r[1:]]
        days += [d for s in self.added.values() for d in s]
        return (min(days), max(days)) if days else None

    def week_mask(self, service_id: str, week: list[dt.date]) -> int:
        mask = 0
        for d in week:
            if self.runs(service_id, d):
                mask |= 1 << d.weekday()
        return mask


def read_calendar(zf: zipfile.ZipFile) -> Calendar:
    cal = Calendar()
    if has_file(zf, "calendar.txt"):
        cols = ["service_id", *DAYS, "start_date", "end_date"]
        for row in iter_rows(zf, "calendar.txt", cols):
            cal.weekly[row[0]] = (tuple(v == "1" for v in row[1:8]), parse_date(row[8]), parse_date(row[9]))
    if has_file(zf, "calendar_dates.txt"):
        for sid, date, ex in iter_rows(zf, "calendar_dates.txt", ["service_id", "date", "exception_type"]):
            (cal.added if ex == "1" else cal.removed)[sid].add(parse_date(date))
    return cal


def reference_week(cal: Calendar, start: dt.date) -> list[dt.date]:
    """Seven consecutive dates from ``start`` (moved into the feed's validity if the feed
    starts later or ends earlier), one per weekday."""
    rng = cal.date_range()
    if rng is not None:
        lo, hi = rng
        if start < lo:
            start = lo
        if start + dt.timedelta(days=6) > hi:
            start = max(lo, hi - dt.timedelta(days=6))
    return [start + dt.timedelta(days=n) for n in range(7)]

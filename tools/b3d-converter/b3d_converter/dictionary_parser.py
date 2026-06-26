from __future__ import annotations

import re

from .signatures import IMPORTANT_ASCII_FIELDS as IMPORTANT_FIELDS
from .types import StringHit

ASCII_RE = re.compile(rb"[A-Za-z0-9_.\-]{2,}")


def extract_ascii_strings(data: bytes, min_len: int = 2) -> list[StringHit]:
    hits: list[StringHit] = []

    for match in ASCII_RE.finditer(data):
        value = match.group(0).decode("ascii", errors="ignore")
        if len(value) < min_len:
            continue
        hits.append(StringHit(value=value, offset=match.start(), encoding="ascii"))

    return hits


def extract_utf16le_strings(data: bytes, min_chars: int = 3) -> list[StringHit]:
    hits: list[StringHit] = []
    current = bytearray()
    start_offset: int | None = None
    i = 0

    while i + 1 < len(data):
        lo = data[i]
        hi = data[i + 1]

        if hi == 0 and (32 <= lo <= 126 or lo >= 128):
            if start_offset is None:
                start_offset = i
            current.extend([lo, hi])
            i += 2
            continue

        if start_offset is not None and len(current) >= min_chars * 2:
            try:
                value = current.decode("utf-16le", errors="ignore").strip("\x00")
                if len(value) >= min_chars:
                    hits.append(
                        StringHit(value=value, offset=start_offset, encoding="utf-16le")
                    )
            except Exception:
                pass

        current = bytearray()
        start_offset = None
        i += 1

    return hits


def find_important_fields(strings: list[StringHit]) -> list[str]:
    values = {item.value for item in strings}
    return [field for field in IMPORTANT_FIELDS if field in values]


def analyze_dictionary(data: bytes) -> dict:
    strings = extract_ascii_strings(data) + extract_utf16le_strings(data)
    important = find_important_fields(strings)

    score = 0
    for field in ["X", "Y", "Z", "MinX", "MaxX", "Width", "Height", "Depth"]:
        if field in important:
            score += 1
    for field in ["TriData", "Contour", "Holes", "Materials", "Furniture", "Elements"]:
        if field in important:
            score += 3

    return {
        "strings": strings,
        "important_fields": important,
        "dictionary_confidence": score,
    }

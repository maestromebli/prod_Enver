from __future__ import annotations

import re

from .signatures import IMPORTANT_ASCII_FIELDS
from .types import StringHit

ASCII_RE = re.compile(rb"[A-Za-z0-9_.\-]{2,}")


def extract_ascii_strings(data: bytes, min_len: int = 2) -> list[StringHit]:
    hits: list[StringHit] = []

    for match in ASCII_RE.finditer(data):
        raw = match.group(0)
        if len(raw) < min_len:
            continue

        try:
            value = raw.decode("ascii", errors="ignore")
        except Exception:
            continue

        hits.append(
            StringHit(
                value=value,
                offset=match.start(),
                encoding="ascii",
            )
        )

    return hits


def extract_utf16le_strings(data: bytes, min_chars: int = 3) -> list[StringHit]:
    hits: list[StringHit] = []

    current = bytearray()
    start_offset = None

    i = 0
    while i + 1 < len(data):
        lo = data[i]
        hi = data[i + 1]

        if hi == 0 and (32 <= lo <= 126 or lo >= 0x80):
            if start_offset is None:
                start_offset = i
            current.extend([lo, hi])
            i += 2
            continue

        if start_offset is not None and len(current) >= min_chars * 2:
            try:
                value = current.decode("utf-16le", errors="ignore").strip("\x00")
                if len(value) >= min_chars:
                    hits.append(StringHit(value=value, offset=start_offset, encoding="utf-16le"))
            except Exception:
                pass

        current = bytearray()
        start_offset = None
        i += 1

    return hits


def find_important_fields(strings: list[StringHit]) -> list[str]:
    values = {s.value for s in strings}
    found: list[str] = []
    for field in IMPORTANT_ASCII_FIELDS:
        if field in values:
            found.append(field)
    return found

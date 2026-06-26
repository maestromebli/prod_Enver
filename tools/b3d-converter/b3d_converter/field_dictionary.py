from __future__ import annotations

import struct

from .signatures import IMPORTANT_ASCII_FIELDS
from .types import FieldDictEntry, FieldDictionary


def _is_plausible_field_name(name: str) -> bool:
    if not name or len(name) > 64:
        return False
    if not name[0].isalpha() and name[0] != "_":
        return False
    return all(c.isalnum() or c in "._-" for c in name)


def parse_field_dictionary(data: bytes, max_entries: int = 500) -> FieldDictionary | None:
    """
    Експериментальний парсер словника полів B3D:
    послідовність [length:u32le][ascii bytes без null-terminator].
  """
    entries: list[FieldDictEntry] = []
    offset = 0
    consecutive_hits = 0

    while offset + 4 < len(data) and len(entries) < max_entries:
        try:
            length = struct.unpack_from("<I", data, offset)[0]
        except struct.error:
            break

        if length < 1 or length > 64:
            consecutive_hits = 0
            offset += 1
            continue

        str_start = offset + 4
        str_end = str_start + length
        if str_end > len(data):
            break

        raw = data[str_start:str_end]
        if b"\x00" in raw:
            consecutive_hits = 0
            offset += 1
            continue

        try:
            name = raw.decode("ascii")
        except UnicodeDecodeError:
            consecutive_hits = 0
            offset += 1
            continue

        if not _is_plausible_field_name(name):
            consecutive_hits = 0
            offset += 1
            continue

        entries.append(FieldDictEntry(name=name, offset=offset, length=length))
        consecutive_hits += 1
        offset = str_end

        if consecutive_hits >= 8 and len(entries) >= 10:
            known = sum(1 for e in entries if e.name in IMPORTANT_ASCII_FIELDS)
            if known >= 5:
                return FieldDictionary(
                    entries=entries,
                    data_start_offset=offset,
                    encoding="ascii",
                )

    if len(entries) >= 15:
        known = sum(1 for e in entries if e.name in IMPORTANT_ASCII_FIELDS)
        if known >= 8:
            return FieldDictionary(
                entries=entries,
                data_start_offset=offset,
                encoding="ascii",
            )

    return None


def find_field_dictionary_in_payloads(payloads: list[bytes]) -> FieldDictionary | None:
    best: FieldDictionary | None = None
    best_score = 0

    for payload in payloads:
        for start in (0, 4, 8, 16, 32, 64, 128):
            if start >= len(payload):
                continue
            parsed = parse_field_dictionary(payload[start:])
            if not parsed:
                continue
            known = sum(1 for e in parsed.entries if e.name in IMPORTANT_ASCII_FIELDS)
            score = known * 10 + len(parsed.entries)
            if score > best_score:
                best_score = score
                best = FieldDictionary(
                    entries=[
                        FieldDictEntry(
                            name=e.name,
                            offset=e.offset + start,
                            length=e.length,
                        )
                        for e in parsed.entries
                    ],
                    data_start_offset=(parsed.data_start_offset or 0) + start,
                    encoding=parsed.encoding,
                )

    return best

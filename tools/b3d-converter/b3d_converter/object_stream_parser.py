from __future__ import annotations

import struct

from .dictionary_parser import analyze_dictionary


def find_object_markers(data: bytes) -> list[dict]:
    """Шукає ймовірні маркери об'єктів (Obj/Objs/Model/Furniture) у payload."""
    dictionary = analyze_dictionary(data)
    markers: list[dict] = []

    for hit in dictionary["strings"]:
        if hit.value in ("Obj", "Objs", "Model", "Furniture", "Elements", "Drawing"):
            markers.append(
                {
                    "name": hit.value,
                    "offset": hit.offset,
                    "encoding": hit.encoding,
                }
            )

    return markers[:200]


def scan_object_stream_regions(
    data: bytes, window: int = 4096
) -> list[dict]:
    """Повертає діапазони байтів навколо object-маркерів для подальшого RE."""
    regions: list[dict] = []

    for marker in find_object_markers(data):
        start = max(0, marker["offset"] - 64)
        end = min(len(data), marker["offset"] + window)
        sample = data[start:end]

        float_hits = 0
        for offset in range(0, len(sample) - 12, 4):
            try:
                x, y, z = struct.unpack_from("<fff", sample, offset)
            except Exception:
                continue
            if all(-100000 <= v <= 100000 for v in (x, y, z)):
                float_hits += 1

        regions.append(
            {
                "marker": marker["name"],
                "offset": marker["offset"],
                "region_start": start,
                "region_end": end,
                "float_triplet_hits": float_hits,
            }
        )

    regions.sort(key=lambda item: item["float_triplet_hits"], reverse=True)
    return regions[:50]

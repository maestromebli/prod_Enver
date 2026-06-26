from __future__ import annotations

import math
import struct
from collections import Counter

from .types import BoundingBox, NumericCandidate


def is_reasonable_dimension(value: float) -> bool:
    return math.isfinite(value) and -100000 <= value <= 100000 and abs(value) >= 0.01


def scan_float64_candidates(
    data: bytes,
    max_results: int = 20000,
    step: int = 1,
) -> list[NumericCandidate]:
    results: list[NumericCandidate] = []

    for offset in range(0, len(data) - 8, step):
        try:
            value = struct.unpack_from("<d", data, offset)[0]
        except Exception:
            continue

        if not is_reasonable_dimension(value):
            continue

        confidence = 0.2
        reason = "finite furniture-like float64"

        rounded = abs(value)
        if 0.1 <= rounded <= 10000:
            confidence += 0.2
        if abs(value - round(value, 2)) < 1e-9:
            confidence += 0.1

        results.append(
            NumericCandidate(
                offset=offset,
                value=value,
                dtype="float64",
                confidence=confidence,
                reason=reason,
            )
        )

        if len(results) >= max_results:
            break

    return results


def scan_float32_candidates(
    data: bytes,
    max_results: int = 50000,
    step: int = 1,
) -> list[NumericCandidate]:
    results: list[NumericCandidate] = []

    for offset in range(0, len(data) - 4, step):
        try:
            value = struct.unpack_from("<f", data, offset)[0]
        except Exception:
            continue

        if not is_reasonable_dimension(value):
            continue

        confidence = 0.15
        reason = "finite furniture-like float32"

        if 0.1 <= abs(value) <= 10000:
            confidence += 0.2
        if abs(value - round(value, 2)) < 1e-5:
            confidence += 0.05

        results.append(
            NumericCandidate(
                offset=offset,
                value=value,
                dtype="float32",
                confidence=confidence,
                reason=reason,
            )
        )

        if len(results) >= max_results:
            break

    return results


def estimate_bounding_box_from_numbers(numbers: list[NumericCandidate]) -> BoundingBox | None:
    values = [n.value for n in numbers if -10000 <= n.value <= 10000]

    if len(values) < 6:
        return None

    sorted_values = sorted(values)
    lo_idx = int(len(sorted_values) * 0.01)
    hi_idx = int(len(sorted_values) * 0.99)

    filtered = sorted_values[lo_idx:hi_idx]
    if len(filtered) < 6:
        return None

    min_v = min(filtered)
    max_v = max(filtered)

    return BoundingBox(
        min_x=min_v,
        min_y=min_v,
        min_z=min_v,
        max_x=max_v,
        max_y=max_v,
        max_z=max_v,
    )


def extract_axis_bounding_box(numbers: list[NumericCandidate]) -> BoundingBox | None:
    """Спроба зібрати bbox з окремих MinX/MaxX-подібних значень."""
    by_rounded: dict[float, int] = {}
    for n in numbers:
        if not (10 <= abs(n.value) <= 8000):
            continue
        key = round(n.value, 1)
        by_rounded[key] = by_rounded.get(key, 0) + 1

    if len(by_rounded) < 4:
        return None

    common = sorted(by_rounded.items(), key=lambda x: x[1], reverse=True)
    dims = sorted({v for v, _ in common[:12]})
    if len(dims) < 2:
        return None

    lo = min(dims)
    hi = max(dims)
    if hi - lo < 50:
        return None

    return BoundingBox(min_x=0, min_y=0, min_z=0, max_x=hi, max_y=hi * 0.6, max_z=hi * 0.4)


def summarize_numeric_values(numbers: list[NumericCandidate]) -> dict:
    rounded = [round(n.value, 2) for n in numbers if -10000 <= n.value <= 10000]
    counter = Counter(rounded)
    common = counter.most_common(50)

    return {
        "total": len(numbers),
        "most_common_values": [{"value": v, "count": c} for v, c in common],
    }

from __future__ import annotations

import math
import struct

from .signatures import STANDARD_PANEL_THICKNESSES
from .types import PanelSpec


def _round_dim(v: float) -> float:
    return round(v, 1)


def extract_panel_pairs_from_binary(data: bytes, min_panels: int = 3) -> list[PanelSpec]:
    """
    Евристика: пари float64 (Length, Width) з типовою товщиною поруч.
    Не замінює .project, але дає частковий fallback з самого .b3d.
    """
    candidates: dict[tuple[float, float, float], int] = {}

    for offset in range(0, len(data) - 24, 8):
        try:
            length, width = struct.unpack_from("<dd", data, offset)
        except struct.error:
            continue

        if not (100 <= length <= 4000 and 100 <= width <= 4000):
            continue
        if abs(length - round(length)) > 0.05 or abs(width - round(width)) > 0.05:
            continue

        thickness = 18.0
        for t_off in (16, 24, -8):
            t_pos = offset + t_off
            if t_pos < 0 or t_pos + 8 > len(data):
                continue
            try:
                t_val = struct.unpack_from("<d", data, t_pos)[0]
            except struct.error:
                continue
            if not math.isfinite(t_val):
                continue
            t_round = round(t_val)
            if t_round in STANDARD_PANEL_THICKNESSES:
                thickness = float(t_round)
                break

        key = (_round_dim(length), _round_dim(width), thickness)
        candidates[key] = candidates.get(key, 0) + 1

    ranked = sorted(candidates.items(), key=lambda x: (-x[1], -x[0][0]))
    panels: list[PanelSpec] = []
    for (length, width, thickness), count in ranked:
        if count < 1:
            continue
        panels.append(
            PanelSpec(
                width=length,
                height=width,
                depth=thickness,
                label=f"bin_{int(length)}x{int(width)}",
            )
        )
        if len(panels) >= 40:
            break

    return panels if len(panels) >= min_panels else []


def extract_panel_int_pairs(data: bytes, min_panels: int = 3) -> list[PanelSpec]:
    candidates: dict[tuple[int, int, int], int] = {}

    for offset in range(0, len(data) - 12, 4):
        try:
            length, width, thick = struct.unpack_from("<iii", data, offset)
        except struct.error:
            continue
        if not (100 <= length <= 4000 and 100 <= width <= 4000):
            continue
        if thick not in STANDARD_PANEL_THICKNESSES:
            continue
        key = (length, width, thick)
        candidates[key] = candidates.get(key, 0) + 1

    panels = [
        PanelSpec(width=l, height=w, depth=t, label=f"int_{l}x{w}")
        for (l, w, t), _ in sorted(candidates.items(), key=lambda x: -x[1])[:40]
    ]
    return panels if len(panels) >= min_panels else []

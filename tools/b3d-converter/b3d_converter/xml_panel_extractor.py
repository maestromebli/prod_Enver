from __future__ import annotations

import re
import struct
from pathlib import Path

from .types import PanelSpec


_PART_TAG_RE = re.compile(rb"<part\b[^>]*>", re.IGNORECASE)
_DIM3_RE = re.compile(r"(\d{3,4})\s*[xX×]\s*(\d{3,4})\s*[xX×]\s*(\d{1,2})")
_ATTR_RE = re.compile(r'(\w+)\s*=\s*"([^"]*)"', re.IGNORECASE)


def extract_xml_panels_from_buffer(data: bytes) -> list[PanelSpec]:
    """Витягує панелі з XML <part .../> усередині .b3d або розпакованого блоку."""
    text = data.decode("utf-8", errors="ignore")
    if "<part" not in text.lower():
        return []

    panels: list[PanelSpec] = []
    seen: set[str] = set()

    for match in _PART_TAG_RE.finditer(data):
        tag = match.group(0).decode("utf-8", errors="ignore")
        attrs = {k.lower(): v for k, v in _ATTR_RE.findall(tag)}
        code = attrs.get("code") or attrs.get("number") or attrs.get("id") or ""
        if not code or code in seen:
            continue
        seen.add(code)

        length_mm = float(attrs.get("dl") or attrs.get("length") or attrs.get("l") or 0)
        width_mm = float(attrs.get("dw") or attrs.get("width") or attrs.get("w") or 0)
        thickness_mm = float(
            attrs.get("dz") or attrs.get("thickness") or attrs.get("thick") or attrs.get("t") or 18
        )

        if length_mm <= 0 or width_mm <= 0:
            continue

        panels.append(
            PanelSpec(
                width=length_mm,
                height=width_mm,
                depth=thickness_mm if thickness_mm > 0 else 18,
                label=f"panel_{code}",
            )
        )

    return panels


def extract_sheet_dimensions_from_text(data: bytes) -> list[PanelSpec]:
    """Евристика: типорозміри листів ДСП з utf-16/ascii (2800x2070x18)."""
    u16 = data.decode("utf-16le", errors="ignore")
    ascii_text = data.decode("latin-1", errors="ignore")
    found: list[PanelSpec] = []

    for text in (u16, ascii_text):
        for m in _DIM3_RE.finditer(text):
            w, h, t = float(m.group(1)), float(m.group(2)), float(m.group(3))
            if 100 <= w <= 4000 and 100 <= h <= 4000 and t in (10, 16, 18, 19, 22, 25, 36):
                found.append(PanelSpec(width=w, height=h, depth=t, label=f"sheet_{int(w)}x{int(h)}"))

    unique: list[PanelSpec] = []
    seen: set[tuple[float, float, float]] = set()
    for p in found:
        key = (p.width, p.height, p.depth)
        if key in seen:
            continue
        seen.add(key)
        unique.append(p)

    return unique[:12]

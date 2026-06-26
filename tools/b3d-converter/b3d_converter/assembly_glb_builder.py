from __future__ import annotations

import math
import re
from typing import Any

from .types import PositionedPanel, ProjectPanel

MM = 0.001
_ATTR_RE = re.compile(r'(\w+)\s*=\s*"([^"]*)"', re.IGNORECASE)
_PART_TAG_RE = re.compile(rb"<part\b[^>]*>", re.IGNORECASE)


def normalize_part_code(code: str) -> str:
    text = str(code or "").strip()
    if not text:
        return ""
    num = re.sub(r"\D", "", text)
    if num:
        return str(int(num, 10))
    return text


def extract_project_panels(data: bytes) -> list[ProjectPanel]:
    """Панелі з XML .project усередині Bazis .b3d / zlib payload."""
    if b"<part" not in data.lower():
        return []

    panels: list[ProjectPanel] = []
    seen: set[str] = set()

    for match in _PART_TAG_RE.finditer(data):
        tag = match.group(0).decode("utf-8", errors="ignore")
        attrs = {k.lower(): v for k, v in _ATTR_RE.findall(tag)}
        code = (
            attrs.get("code")
            or attrs.get("part.code")
            or attrs.get("number")
            or attrs.get("id")
            or ""
        )
        code = str(code).strip()
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
            ProjectPanel(
                code=code,
                length_mm=length_mm,
                width_mm=width_mm,
                thickness_mm=thickness_mm if thickness_mm > 0 else 18,
                part_name=attrs.get("name") or f"Деталь {code}",
            )
        )

    return panels


def bazis_mm_to_gltf(xyz: list[float] | tuple[float, float, float]) -> tuple[float, float, float]:
    x, y, z = float(xyz[0]), float(xyz[1]), float(xyz[2])
    return (x * MM, z * MM, -y * MM)


def bazis_dir_to_gltf(xyz: list[float] | tuple[float, float, float]) -> tuple[float, float, float]:
    x, y, z = bazis_mm_to_gltf(xyz)
    length = math.hypot(x, y, z)
    if length < 1e-9:
        return (0.0, 1.0, 0.0)
    return (x / length, y / length, z / length)


def quaternion_from_axes(
    axis_x: tuple[float, float, float],
    axis_y: tuple[float, float, float],
    axis_z: tuple[float, float, float],
) -> tuple[float, float, float, float]:
    m00, m10, m20 = axis_x
    m01, m11, m21 = axis_y
    m02, m12, m22 = axis_z

    trace = m00 + m11 + m22
    if trace > 0:
        s = math.sqrt(trace + 1) * 2
        qw = 0.25 * s
        qx = (m21 - m12) / s
        qy = (m02 - m20) / s
        qz = (m10 - m01) / s
    elif m00 > m11 and m00 > m22:
        s = math.sqrt(1 + m00 - m11 - m22) * 2
        qw = (m21 - m12) / s
        qx = 0.25 * s
        qy = (m01 + m10) / s
        qz = (m02 + m20) / s
    elif m11 > m22:
        s = math.sqrt(1 + m11 - m00 - m22) * 2
        qw = (m02 - m20) / s
        qx = (m01 + m10) / s
        qy = 0.25 * s
        qz = (m12 + m21) / s
    else:
        s = math.sqrt(1 + m22 - m00 - m11) * 2
        qw = (m10 - m01) / s
        qx = (m02 + m20) / s
        qy = (m12 + m21) / s
        qz = 0.25 * s

    length = math.hypot(qx, qy, qz, qw) or 1.0
    return (qx / length, qy / length, qz / length, qw / length)


def _scale_from_size_mm(size_mm: list[float]) -> tuple[float, float, float]:
    gx = bazis_mm_to_gltf([size_mm[0], 0, 0])
    gy = bazis_mm_to_gltf([0, size_mm[1], 0])
    gz = bazis_mm_to_gltf([0, 0, size_mm[2]])
    return (
        math.hypot(gx[0], gx[1], gx[2]),
        math.hypot(gy[0], gy[1], gy[2]),
        math.hypot(gz[0], gz[1], gz[2]),
    )


def _scale_from_project_panel(panel: ProjectPanel) -> tuple[float, float, float]:
    return (
        panel.length_mm * MM,
        panel.thickness_mm * MM,
        panel.width_mm * MM,
    )


def layout_enver3_panels(assembly: dict[str, Any]) -> list[PositionedPanel]:
    """3D-збірка лише з ENVER3 (хвіст Bazis .b3d після enver-b3d-assembly-export.js)."""
    laid_out: list[PositionedPanel] = []

    for asm in assembly.get("panels") or []:
        code = str(asm.get("code") or "").strip()
        if not code:
            continue

        center = asm.get("centerMm") or [0, 0, 0]
        size = asm.get("sizeMm")
        if isinstance(size, list) and len(size) >= 3:
            scale = _scale_from_size_mm([float(size[0]), float(size[1]), float(size[2])])
        else:
            scale = (0.5, 0.018, 0.3)

        axis_x = bazis_dir_to_gltf(asm.get("axisX") or [1, 0, 0])
        axis_y = bazis_dir_to_gltf(asm.get("axisY") or [0, 1, 0])
        axis_z = bazis_dir_to_gltf(asm.get("axisZ") or [0, 0, 1])
        rotation = quaternion_from_axes(axis_x, axis_y, axis_z)

        laid_out.append(
            PositionedPanel(
                code=code,
                translation=bazis_mm_to_gltf(center),
                scale=scale,
                rotation=rotation,
            )
        )

    return laid_out


def layout_assembly_with_project(
    project_panels: list[ProjectPanel], assembly: dict[str, Any]
) -> tuple[list[PositionedPanel], list[str]]:
    """Збірка: розміри з .project + координати з ENVER3."""
    asm_map = {
        normalize_part_code(p.get("code")): p for p in (assembly.get("panels") or [])
    }
    laid_out: list[PositionedPanel] = []
    missing: list[str] = []

    for panel in project_panels:
        asm = asm_map.get(normalize_part_code(panel.code))
        if not asm:
            missing.append(panel.code)
            continue

        center = asm.get("centerMm") or [0, 0, 0]
        size = asm.get("sizeMm")
        if isinstance(size, list) and len(size) >= 3:
            scale = _scale_from_size_mm([float(size[0]), float(size[1]), float(size[2])])
        else:
            scale = _scale_from_project_panel(panel)

        axis_x = bazis_dir_to_gltf(asm.get("axisX") or [1, 0, 0])
        axis_y = bazis_dir_to_gltf(asm.get("axisY") or [0, 1, 0])
        axis_z = bazis_dir_to_gltf(asm.get("axisZ") or [0, 0, 1])

        laid_out.append(
            PositionedPanel(
                code=panel.code,
                translation=bazis_mm_to_gltf(center),
                scale=scale,
                rotation=quaternion_from_axes(axis_x, axis_y, axis_z),
            )
        )

    return laid_out, missing

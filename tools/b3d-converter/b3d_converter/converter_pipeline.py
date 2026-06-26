from __future__ import annotations

from pathlib import Path

from .assembly_glb_builder import (
    extract_project_panels,
    layout_assembly_with_project,
    layout_enver3_panels,
)
from .b3d_binary_panels import extract_panel_int_pairs, extract_panel_pairs_from_binary
from .embedded_glb import find_embedded_glb, is_glb_buffer
from .enver3_parser import extract_enver3_assembly
from .geometry_detector import build_panel_mesh, detect_panel_specs_from_numbers
from .mesh_builder import choose_best_mesh
from .object_stream_parser import scan_object_stream_regions
from .panel_glb_builder import build_positioned_panels_glb
from .types import B3DReport, MeshCandidate, PanelSpec, ProjectPanel
from .xml_panel_extractor import extract_sheet_dimensions_from_text, extract_xml_panels_from_buffer


def try_write_embedded_glb(raw: bytes, payloads: list[bytes], out_path: str | Path) -> str | None:
    """Зберігає вбудований GLB без перебудови mesh."""
    out = Path(out_path)
    candidates = [raw] + payloads

    for blob in candidates:
        if is_glb_buffer(blob):
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(blob)
            return "embedded_raw_glb"

    for blob in candidates:
        embedded = find_embedded_glb(blob)
        if embedded:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(embedded)
            return "embedded_glb"

    return None


def _collect_project_panels(payloads: list[bytes]) -> list[ProjectPanel]:
    panels: list[ProjectPanel] = []
    seen: set[str] = set()
    for payload in payloads:
        for panel in extract_project_panels(payload):
            if panel.code in seen:
                continue
            seen.add(panel.code)
            panels.append(panel)
    return panels


def try_write_enver3_assembly_glb(
    raw: bytes, payloads: list[bytes], out_path: str | Path
) -> tuple[str | None, int]:
    """
    3D-збірка з хвоста ENVER3 (експорт Bazis через enver-b3d-assembly-export.js).
    Якщо в zlib є .project XML — зіставляє коди деталей.
    """
    assembly = extract_enver3_assembly(raw)
    if not assembly or not assembly.get("panels"):
        return None, 0

    out = Path(out_path)
    project_panels = _collect_project_panels(payloads)
    source = "b3d_enver3_assembly"

    if project_panels:
        positioned, _missing = layout_assembly_with_project(project_panels, assembly)
        if not positioned:
            positioned = layout_enver3_panels(assembly)
            source = "b3d_enver3_only"
    else:
        positioned = layout_enver3_panels(assembly)
        source = "b3d_enver3_only"

    if not positioned:
        return None, 0

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(build_positioned_panels_glb(positioned))
    return source, len(positioned)


def collect_panel_specs(report: B3DReport, payloads: list[bytes]) -> list[PanelSpec]:
    panels: list[PanelSpec] = list(report.panel_specs or [])

    for payload in payloads:
        panels.extend(extract_xml_panels_from_buffer(payload))
    if len(panels) < 2:
        for payload in payloads:
            panels.extend(extract_sheet_dimensions_from_text(payload))
    if len(panels) < 2:
        for payload in payloads:
            panels.extend(extract_panel_pairs_from_binary(payload))
            if len(panels) >= 2:
                break
    if len(panels) < 2:
        for payload in payloads:
            panels.extend(extract_panel_int_pairs(payload))
            if len(panels) >= 2:
                break

    if len(panels) < 2:
        dim_values = [n.value for n in report.numeric_candidates if 50 <= abs(n.value) <= 4000]
        panels = detect_panel_specs_from_numbers(dim_values)

    unique: list[PanelSpec] = []
    seen: set[tuple[float, float, float]] = set()
    for p in panels:
        key = (round(p.width, 1), round(p.height, 1), round(p.depth, 1))
        if key in seen:
            continue
        seen.add(key)
        unique.append(p)

    return unique


def resolve_export_mesh(
    report: B3DReport,
    payloads: list[bytes],
    raw: bytes,
) -> tuple[MeshCandidate | None, str, list[PanelSpec]]:
    """Повертає (mesh, kind, panels). kind: READY | FALLBACK_READY | NONE"""
    if payloads:
        for idx, payload in enumerate(payloads[:3]):
            regions = scan_object_stream_regions(payload)
            if regions:
                report.metadata.setdefault("object_stream_regions", []).append(
                    {"zlib_index": idx, "top": regions[:5]}
                )

    panels = collect_panel_specs(report, payloads)

    if len(panels) >= 2:
        panel_mesh = build_panel_mesh(panels, name="panel_preview")
        if panel_mesh.triangles:
            return panel_mesh, "FALLBACK_READY", panels

    mesh, output_kind = choose_best_mesh(
        report.mesh_candidates,
        report.bounding_box,
        panels if len(panels) >= 1 else None,
    )

    if mesh and output_kind != "NONE":
        return mesh, output_kind, panels

    return None, "NONE", panels

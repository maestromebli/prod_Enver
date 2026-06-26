from __future__ import annotations

from .geometry_detector import (
    build_panel_mesh,
    create_box_mesh,
    detect_panel_specs_from_numbers,
)
from .types import BoundingBox, MeshCandidate, PanelSpec


def choose_best_mesh(
    meshes: list[MeshCandidate],
    bbox: BoundingBox | None,
    panels: list[PanelSpec] | None = None,
) -> tuple[MeshCandidate | None, str]:
    """
    Повертає (mesh, output_kind) де output_kind:
    READY | FALLBACK_READY | None
    """
    valid = [m for m in meshes if m.vertices and m.triangles]

    if valid:
        valid.sort(key=lambda m: (m.confidence, len(m.vertices), len(m.triangles)), reverse=True)
        best = valid[0]
        if best.confidence >= 0.5:
            return best, "READY"
        return best, "FALLBACK_READY"

    if panels:
        panel_mesh = build_panel_mesh(panels)
        if panel_mesh.vertices and panel_mesh.triangles:
            return panel_mesh, "FALLBACK_READY"

    if bbox:
        return create_box_mesh(bbox, name="b3d_fallback_bounding_box"), "FALLBACK_READY"

    return None, "NONE"

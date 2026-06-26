from __future__ import annotations

from .geometry_detector import build_panel_mesh, create_box_mesh as _create_box_mesh
from .types import BoundingBox, MeshCandidate, PanelSpec


def create_box_mesh(bbox: BoundingBox, name: str = "fallback_box") -> MeshCandidate:
    return _create_box_mesh(bbox, name=name)


def create_panel_preview_mesh(panels: list[PanelSpec]) -> MeshCandidate | None:
    if len(panels) < 2:
        return None
    return build_panel_mesh(panels, name="panel_preview")

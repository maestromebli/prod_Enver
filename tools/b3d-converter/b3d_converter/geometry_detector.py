from __future__ import annotations

import math
import struct

from .signatures import STANDARD_PANEL_THICKNESSES
from .types import BoundingBox, MeshCandidate, PanelSpec, Triangle, Vertex


def _valid_vertex(x: float, y: float, z: float) -> bool:
    if not all(math.isfinite(v) for v in [x, y, z]):
        return False
    if not all(-100000 <= v <= 100000 for v in [x, y, z]):
        return False
    # Відсікаємо майже нульовий бінарний шум
    if max(abs(x), abs(y), abs(z)) < 1.0:
        return False
    return True


def detect_interleaved_float32_vertices(
    data: bytes,
    min_vertices: int = 8,
    max_vertices: int = 200000,
    has_tridata: bool = False,
) -> list[MeshCandidate]:
    candidates: list[MeshCandidate] = []
    current: list[Vertex] = []
    current_start = 0

    base_confidence = 0.25 if has_tridata else 0.15

    for offset in range(0, len(data) - 12, 4):
        try:
            x, y, z = struct.unpack_from("<fff", data, offset)
        except Exception:
            continue

        if _valid_vertex(x, y, z):
            if not current:
                current_start = offset
            current.append(Vertex(x=x, y=y, z=z))

            if len(current) > max_vertices:
                break
        else:
            if len(current) >= min_vertices:
                conf = min(0.65, base_confidence + len(current) / 20000)
                candidates.append(
                    MeshCandidate(
                        name=f"float32_vertices_at_{current_start}",
                        vertices=current.copy(),
                        triangles=[],
                        confidence=conf,
                        source=f"offset:{current_start}",
                        notes=["Detected as sequential float32 xyz triplets"],
                    )
                )
            current = []

    if len(current) >= min_vertices:
        conf = min(0.65, base_confidence + len(current) / 20000)
        candidates.append(
            MeshCandidate(
                name=f"float32_vertices_at_{current_start}",
                vertices=current.copy(),
                triangles=[],
                confidence=conf,
                source=f"offset:{current_start}",
                notes=["Detected as sequential float32 xyz triplets"],
            )
        )

    candidates.sort(key=lambda c: (c.confidence, len(c.vertices)), reverse=True)
    return candidates[:20]


def detect_tridata_mesh(
    data: bytes,
    tridata_offset: int,
    has_minmax_fields: bool = False,
) -> MeshCandidate | None:
    """
    Експериментальна спроба знайти вершини та індекси після маркера TriData.
    """
    search_start = tridata_offset
    vertices: list[Vertex] = []

    for offset in range(search_start, min(search_start + 500000, len(data) - 12), 4):
        try:
            x, y, z = struct.unpack_from("<fff", data, offset)
        except Exception:
            continue
        if _valid_vertex(x, y, z):
            vertices.append(Vertex(x=x, y=y, z=z))
            if len(vertices) >= 500:
                break
        elif len(vertices) >= 12:
            break

    if len(vertices) < 30:
        return None

    triangles: list[Triangle] = []
    idx_start = search_start + len(vertices) * 12
    for offset in range(idx_start, min(idx_start + 200000, len(data) - 12), 4):
        try:
            a, b, c = struct.unpack_from("<III", data, offset)
        except Exception:
            continue
        if a < len(vertices) and b < len(vertices) and c < len(vertices):
            triangles.append(Triangle(a=a, b=b, c=c))
            if len(triangles) >= 1000:
                break
        elif len(triangles) >= 4:
            break

    if not triangles or len(triangles) < 20:
        return None

    confidence = 0.55
    if has_minmax_fields:
        confidence += 0.1
    if len(triangles) >= 20:
        confidence += 0.1

    return MeshCandidate(
        name=f"tridata_mesh_at_{tridata_offset}",
        vertices=vertices,
        triangles=triangles,
        confidence=min(0.85, confidence),
        source=f"tridata:{tridata_offset}",
        notes=["TriData-adjacent vertex/index heuristic"],
    )


def create_box_mesh(bbox: BoundingBox, name: str = "fallback_box") -> MeshCandidate:
    min_x, min_y, min_z = bbox.min_x, bbox.min_y, bbox.min_z
    max_x, max_y, max_z = bbox.max_x, bbox.max_y, bbox.max_z

    vertices = [
        Vertex(min_x, min_y, min_z),
        Vertex(max_x, min_y, min_z),
        Vertex(max_x, max_y, min_z),
        Vertex(min_x, max_y, min_z),
        Vertex(min_x, min_y, max_z),
        Vertex(max_x, min_y, max_z),
        Vertex(max_x, max_y, max_z),
        Vertex(min_x, max_y, max_z),
    ]

    triangles = [
        Triangle(0, 1, 2),
        Triangle(0, 2, 3),
        Triangle(4, 6, 5),
        Triangle(4, 7, 6),
        Triangle(0, 4, 5),
        Triangle(0, 5, 1),
        Triangle(1, 5, 6),
        Triangle(1, 6, 2),
        Triangle(2, 6, 7),
        Triangle(2, 7, 3),
        Triangle(3, 7, 4),
        Triangle(3, 4, 0),
    ]

    return MeshCandidate(
        name=name,
        vertices=vertices,
        triangles=triangles,
        confidence=0.2,
        source="fallback_bbox",
        notes=["Fallback bounding box mesh, not exact furniture geometry"],
    )


def detect_panel_specs_from_numbers(values: list[float]) -> list[PanelSpec]:
    """Виявлення типових розмірів плит ДСП."""
    rounded = [round(v, 1) for v in values if 100 <= abs(v) <= 4000]
    thicknesses = [v for v in rounded if v in STANDARD_PANEL_THICKNESSES]
    large_dims = sorted({v for v in rounded if v >= 200}, reverse=True)

    if not thicknesses or len(large_dims) < 2:
        return []

    thickness = max(set(thicknesses), key=thicknesses.count)
    panels: list[PanelSpec] = []
    used = set()

    for i, w in enumerate(large_dims[:6]):
        for h in large_dims[i + 1 : i + 3]:
            key = (w, h, thickness)
            if key in used:
                continue
            used.add(key)
            panels.append(
                PanelSpec(
                    width=w,
                    height=h,
                    depth=thickness,
                    x=i * (w + 20),
                    y=0,
                    z=0,
                    label=f"panel_{len(panels)}",
                )
            )
            if len(panels) >= 8:
                return panels

    return panels


def build_panel_mesh(panels: list[PanelSpec], name: str = "panel_fallback") -> MeshCandidate:
    all_vertices: list[Vertex] = []
    all_triangles: list[Triangle] = []
    base_index = 0

    for panel in panels:
        x, y, z = panel.x, panel.y, panel.z
        w, h, d = panel.width, panel.height, panel.depth

        box = BoundingBox(
            min_x=x,
            min_y=y,
            min_z=z,
            max_x=x + w,
            max_y=y + d,
            max_z=z + h,
        )
        part = create_box_mesh(box, name=panel.label)
        all_vertices.extend(part.vertices)
        for tri in part.triangles:
            all_triangles.append(Triangle(tri.a + base_index, tri.b + base_index, tri.c + base_index))
        base_index += len(part.vertices)

    return MeshCandidate(
        name=name,
        vertices=all_vertices,
        triangles=all_triangles,
        confidence=0.35,
        source="panel_fallback",
        notes=[
            "Approximate panel boxes from detected furniture dimensions",
            "Not exact B3D geometry — experimental fallback",
        ],
    )

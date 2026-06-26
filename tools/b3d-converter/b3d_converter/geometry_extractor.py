from __future__ import annotations

import math
import struct

from .geometry_detector import (
    detect_interleaved_float32_vertices,
    detect_tridata_mesh,
)
from .types import MeshCandidate, Triangle, Vertex


def build_experimental_mesh_from_vertices(candidate: MeshCandidate) -> MeshCandidate:
    if candidate.triangles:
        return candidate

    triangles = create_triangles_from_vertex_order(candidate.vertices)

    return MeshCandidate(
        name=f"{candidate.name}_experimental_triangles",
        vertices=candidate.vertices,
        triangles=triangles,
        confidence=max(0.1, candidate.confidence - 0.2),
        source=candidate.source,
        notes=candidate.notes
        + ["Triangles were created from vertex order. This is experimental and may be incorrect."],
    )

__all__ = [
    "Vertex",
    "Triangle",
    "MeshCandidate",
    "is_valid_vertex",
    "detect_float32_vertex_runs",
    "create_triangles_from_vertex_order",
    "build_experimental_mesh_from_vertices",
    "extract_mesh_candidates_from_payload",
]


def is_valid_vertex(x: float, y: float, z: float) -> bool:
    return (
        math.isfinite(x)
        and math.isfinite(y)
        and math.isfinite(z)
        and -100000 <= x <= 100000
        and -100000 <= y <= 100000
        and -100000 <= z <= 100000
    )


def detect_float32_vertex_runs(data: bytes, min_vertices: int = 12) -> list[MeshCandidate]:
    return detect_interleaved_float32_vertices(data, min_vertices=min_vertices)


def create_triangles_from_vertex_order(vertices: list[Vertex]) -> list[Triangle]:
    triangles: list[Triangle] = []
    for index in range(0, len(vertices) - 2, 3):
        triangles.append(Triangle(index, index + 1, index + 2))
    return triangles


def extract_mesh_candidates_from_payload(
    data: bytes, *, has_tridata: bool = False, has_minmax: bool = False, zlib_index: int = 0
) -> list[MeshCandidate]:
    """Збирає mesh-кандидатів з одного payload (zlib або raw)."""
    candidates = detect_float32_vertex_runs(data)

    if has_tridata:
        tridata_offset = data.find(b"TriData")
        if tridata_offset >= 0:
            tridata_mesh = detect_tridata_mesh(
                data, tridata_offset, has_minmax_fields=has_minmax
            )
            if tridata_mesh:
                candidates.append(tridata_mesh)

    for candidate in candidates:
        candidate.source = f"zlib_block_{zlib_index}:{candidate.source}"

    return sorted(
        candidates,
        key=lambda item: (item.confidence, len(item.vertices), len(item.triangles)),
        reverse=True,
    )[:30]

from __future__ import annotations

import struct
from pathlib import Path

from pygltflib import (
    GLTF2,
    Scene,
    Node,
    Mesh,
    Primitive,
    Buffer,
    BufferView,
    Accessor,
    Asset,
    FLOAT,
    UNSIGNED_INT,
    ARRAY_BUFFER,
    ELEMENT_ARRAY_BUFFER,
    VEC3,
    SCALAR,
)

from .types import MeshCandidate


def _pack_vertices(mesh: MeshCandidate) -> bytes:
    out = bytearray()
    for v in mesh.vertices:
        out.extend(struct.pack("<fff", float(v.x), float(v.y), float(v.z)))
    return bytes(out)


def _pack_indices(mesh: MeshCandidate) -> bytes:
    out = bytearray()
    for t in mesh.triangles:
        out.extend(struct.pack("<III", int(t.a), int(t.b), int(t.c)))
    return bytes(out)


def _min_max_positions(mesh: MeshCandidate) -> tuple[list[float], list[float]]:
    xs = [v.x for v in mesh.vertices]
    ys = [v.y for v in mesh.vertices]
    zs = [v.z for v in mesh.vertices]

    return [min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)]


def write_glb(mesh: MeshCandidate, out_path: str | Path) -> None:
    if not mesh.vertices:
        raise ValueError("Cannot write GLB: mesh has no vertices")

    if not mesh.triangles:
        raise ValueError("Cannot write GLB: mesh has no triangles")

    vertex_bytes = _pack_vertices(mesh)
    index_bytes = _pack_indices(mesh)

    padding = (4 - (len(vertex_bytes) % 4)) % 4
    vertex_bytes_aligned = vertex_bytes + b"\x00" * padding

    binary_blob = vertex_bytes_aligned + index_bytes

    vertex_offset = 0
    index_offset = len(vertex_bytes_aligned)

    gltf = GLTF2(asset=Asset(version="2.0", generator="b3d-converter/0.1.0"))

    gltf.buffers = [Buffer(byteLength=len(binary_blob))]
    gltf.bufferViews = [
        BufferView(
            buffer=0,
            byteOffset=vertex_offset,
            byteLength=len(vertex_bytes),
            target=ARRAY_BUFFER,
        ),
        BufferView(
            buffer=0,
            byteOffset=index_offset,
            byteLength=len(index_bytes),
            target=ELEMENT_ARRAY_BUFFER,
        ),
    ]

    min_pos, max_pos = _min_max_positions(mesh)

    gltf.accessors = [
        Accessor(
            bufferView=0,
            byteOffset=0,
            componentType=FLOAT,
            count=len(mesh.vertices),
            type=VEC3,
            min=min_pos,
            max=max_pos,
        ),
        Accessor(
            bufferView=1,
            byteOffset=0,
            componentType=UNSIGNED_INT,
            count=len(mesh.triangles) * 3,
            type=SCALAR,
        ),
    ]

    gltf.meshes = [
        Mesh(
            primitives=[
                Primitive(
                    attributes={"POSITION": 0},
                    indices=1,
                )
            ]
        )
    ]

    gltf.nodes = [Node(mesh=0, name=mesh.name)]
    gltf.scenes = [Scene(nodes=[0])]
    gltf.scene = 0

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    gltf.set_binary_blob(binary_blob)
    gltf.save_binary(str(out))

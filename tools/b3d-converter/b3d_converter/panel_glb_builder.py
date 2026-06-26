from __future__ import annotations

import base64
import json
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
    Material,
    PbrMetallicRoughness,
    FLOAT,
    UNSIGNED_SHORT,
    ARRAY_BUFFER,
    ELEMENT_ARRAY_BUFFER,
    VEC3,
    SCALAR,
)

import tempfile

from .types import MeshCandidate, PanelSpec, PositionedPanel, Vertex, Triangle

MM = 0.001
PREVIEW_GAP_M = 0.04
PREVIEW_ROW_WIDTH_M = 4.5


def _unit_box() -> tuple[list[Vertex], list[Triangle]]:
    verts = [
        Vertex(-0.5, -0.5, -0.5),
        Vertex(0.5, -0.5, -0.5),
        Vertex(0.5, 0.5, -0.5),
        Vertex(-0.5, 0.5, -0.5),
        Vertex(-0.5, -0.5, 0.5),
        Vertex(0.5, -0.5, 0.5),
        Vertex(0.5, 0.5, 0.5),
        Vertex(-0.5, 0.5, 0.5),
    ]
    tris = [
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
    return verts, tris


def layout_flat_panels(panels: list[PanelSpec]) -> list[PanelSpec]:
    """Розкладка панелей у сітку (як Node layoutPreviewPanels)."""
    x = 0.0
    z = 0.0
    row_depth = 0.0
    laid_out: list[PanelSpec] = []

    for panel in panels:
        sx = panel.width * MM
        sy = panel.depth * MM
        sz = panel.height * MM

        if x > 0 and x + sx > PREVIEW_ROW_WIDTH_M:
            x = 0.0
            z += row_depth + PREVIEW_GAP_M
            row_depth = 0.0

        laid_out.append(
            PanelSpec(
                width=panel.width,
                height=panel.height,
                depth=panel.depth,
                x=x + sx / 2,
                y=sy / 2,
                z=z + sz / 2,
                label=panel.label,
            )
        )

        x += sx + PREVIEW_GAP_M
        row_depth = max(row_depth, sz)

    return laid_out


def build_positioned_panels_glb(
    panels: list[PositionedPanel], product_name: str = "bazis-assembly"
) -> bytes:
    """GLB збірки Bazis: окремий mesh на панель + translation/rotation/scale."""
    if not panels:
        raise ValueError("No positioned panels for assembly GLB")

    unit_verts, unit_tris = _unit_box()

    pos_bytes = bytearray()
    for v in unit_verts:
        pos_bytes.extend(struct.pack("<fff", v.x, v.y, v.z))

    idx_bytes = bytearray()
    for t in unit_tris:
        idx_bytes.extend(struct.pack("<HHH", t.a, t.b, t.c))

    pos_pad = (4 - (len(pos_bytes) % 4)) % 4
    pos_bytes_aligned = bytes(pos_bytes) + b"\x00" * pos_pad
    binary_blob = pos_bytes_aligned + bytes(idx_bytes)

    nodes = []
    for i, panel in enumerate(panels):
        node = Node(
            name=panel.code,
            mesh=i,
            translation=list(panel.translation),
            scale=list(panel.scale),
        )
        if panel.rotation:
            node.rotation = list(panel.rotation)
        nodes.append(node)

    gltf = GLTF2(
        asset=Asset(version="2.0", generator="b3d-converter-bazis-assembly"),
        scene=0,
        scenes=[Scene(nodes=list(range(len(panels))))],
        nodes=nodes,
        meshes=[
            Mesh(
                name=f"panel-{p.code}",
                primitives=[Primitive(attributes={"POSITION": 0}, indices=1, material=0)],
            )
            for p in panels
        ],
        materials=[
            Material(
                name="panel-wood",
                pbrMetallicRoughness=PbrMetallicRoughness(
                    baseColorFactor=[0.78, 0.72, 0.64, 1.0],
                    metallicFactor=0.05,
                    roughnessFactor=0.82,
                ),
            )
        ],
        accessors=[
            Accessor(
                bufferView=0,
                componentType=FLOAT,
                count=8,
                type=VEC3,
                min=[-0.5, -0.5, -0.5],
                max=[0.5, 0.5, 0.5],
            ),
            Accessor(
                bufferView=1,
                componentType=UNSIGNED_SHORT,
                count=36,
                type=SCALAR,
            ),
        ],
        bufferViews=[
            BufferView(buffer=0, byteOffset=0, byteLength=len(pos_bytes), target=ARRAY_BUFFER),
            BufferView(
                buffer=0,
                byteOffset=len(pos_bytes_aligned),
                byteLength=len(idx_bytes),
                target=ELEMENT_ARRAY_BUFFER,
            ),
        ],
        buffers=[Buffer(byteLength=len(binary_blob))],
    )

    gltf.set_binary_blob(binary_blob)
    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as tmp:
        tmp_path = tmp.name
    gltf.save_binary(tmp_path)
    data = Path(tmp_path).read_bytes()
    Path(tmp_path).unlink(missing_ok=True)
    return data


def build_panel_preview_glb(panels: list[PanelSpec], product_name: str = "b3d-preview") -> bytes:
    """GLB з окремим mesh на кожну панель (unit box + scale), як enver-project-preview."""
    if not panels:
        raise ValueError("No panels for GLB")

    laid_out = layout_flat_panels(panels)
    unit_verts, unit_tris = _unit_box()

    pos_bytes = bytearray()
    for v in unit_verts:
        pos_bytes.extend(struct.pack("<fff", v.x, v.y, v.z))

    idx_bytes = bytearray()
    for t in unit_tris:
        idx_bytes.extend(struct.pack("<HHH", t.a, t.b, t.c))

    pos_pad = (4 - (len(pos_bytes) % 4)) % 4
    pos_bytes_aligned = bytes(pos_bytes) + b"\x00" * pos_pad
    binary_blob = pos_bytes_aligned + bytes(idx_bytes)

    gltf = GLTF2(
        asset=Asset(version="2.0", generator="b3d-converter-panel-preview"),
        scene=0,
        scenes=[Scene(nodes=list(range(len(laid_out))))],
        nodes=[
            Node(
                name=p.label,
                mesh=i,
                translation=[p.x, p.y, p.z],
                scale=[p.width * MM, p.depth * MM, p.height * MM],
            )
            for i, p in enumerate(laid_out)
        ],
        meshes=[Mesh(name=f"mesh-{p.label}", primitives=[Primitive(attributes={"POSITION": 0}, indices=1, material=0)]) for p in laid_out],
        materials=[
            Material(
                name="panel-wood",
                pbrMetallicRoughness=PbrMetallicRoughness(
                    baseColorFactor=[0.78, 0.72, 0.64, 1.0],
                    metallicFactor=0.05,
                    roughnessFactor=0.82,
                ),
            )
        ],
        accessors=[
            Accessor(
                bufferView=0,
                componentType=FLOAT,
                count=8,
                type=VEC3,
                min=[-0.5, -0.5, -0.5],
                max=[0.5, 0.5, 0.5],
            ),
            Accessor(
                bufferView=1,
                componentType=UNSIGNED_SHORT,
                count=36,
                type=SCALAR,
            ),
        ],
        bufferViews=[
            BufferView(buffer=0, byteOffset=0, byteLength=len(pos_bytes), target=ARRAY_BUFFER),
            BufferView(
                buffer=0,
                byteOffset=len(pos_bytes_aligned),
                byteLength=len(idx_bytes),
                target=ELEMENT_ARRAY_BUFFER,
            ),
        ],
        buffers=[Buffer(byteLength=len(binary_blob))],
    )

    gltf.set_binary_blob(binary_blob)
    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as tmp:
        tmp_path = tmp.name
    gltf.save_binary(tmp_path)
    data = Path(tmp_path).read_bytes()
    Path(tmp_path).unlink(missing_ok=True)
    return data


def write_panel_preview_glb(panels: list[PanelSpec], out_path: str | Path, product_name: str = "") -> MeshCandidate:
    blob = build_panel_preview_glb(panels, product_name)
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(blob)

    unit_verts, unit_tris = _unit_box()
    return MeshCandidate(
        name="panel_preview",
        vertices=unit_verts,
        triangles=unit_tris,
        confidence=0.45,
        source="panel_preview_glb",
        notes=[f"{len(panels)} panels, flat layout from project/xml/dimensions"],
    )

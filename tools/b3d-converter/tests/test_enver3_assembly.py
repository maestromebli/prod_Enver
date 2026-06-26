import json
import struct
from pathlib import Path

from b3d_converter.assembly_glb_builder import layout_enver3_panels
from b3d_converter.converter_pipeline import try_write_enver3_assembly_glb
from b3d_converter.enver3_parser import extract_enver3_assembly
from b3d_converter.panel_glb_builder import build_positioned_panels_glb


def _append_enver3(b3d: bytes, assembly: dict) -> bytes:
    payload = json.dumps(assembly, ensure_ascii=False).encode("utf-8")
    tail = bytearray(14 + len(payload))
    tail[0:6] = b"ENVER3"
    struct.pack_into("<I", tail, 6, 1)
    struct.pack_into("<I", tail, 10, len(payload))
    tail[14:] = payload
    return b3d + bytes(tail)


def test_extract_enver3_from_bazis_tail():
    assembly = {
        "version": 1,
        "panels": [
            {
                "code": "10",
                "centerMm": [250, 150, 500],
                "sizeMm": [500, 300, 18],
                "axisX": [1, 0, 0],
                "axisY": [0, 1, 0],
                "axisZ": [0, 0, 1],
            }
        ],
    }
    raw = _append_enver3(b"BZ85\x00", assembly)
    parsed = extract_enver3_assembly(raw)
    assert parsed is not None
    assert len(parsed["panels"]) == 1


def test_build_assembly_glb_from_enver3(tmp_path: Path):
    assembly = {
        "version": 1,
        "panels": [
            {
                "code": "10",
                "centerMm": [250, 150, 500],
                "sizeMm": [500, 300, 18],
                "axisX": [1, 0, 0],
                "axisY": [0, 1, 0],
                "axisZ": [0, 0, 1],
            }
        ],
    }
    raw = _append_enver3(b"BZ85\x00", assembly)
    out = tmp_path / "assembly.glb"
    source, count = try_write_enver3_assembly_glb(raw, [], out)
    assert source == "b3d_enver3_only"
    assert count == 1
    data = out.read_bytes()
    assert data[:4] == b"glTF"
    assert len(data) > 500


def test_layout_enver3_panels_count():
    assembly = {
        "panels": [
            {"code": "1", "centerMm": [0, 0, 0], "sizeMm": [600, 400, 18]},
            {"code": "2", "centerMm": [100, 0, 0], "sizeMm": [600, 400, 18]},
        ]
    }
    laid_out = layout_enver3_panels(assembly)
    blob = build_positioned_panels_glb(laid_out)
    assert len(laid_out) == 2
    assert blob[:4] == b"glTF"

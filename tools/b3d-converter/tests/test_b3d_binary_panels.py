import struct
import zlib

from b3d_converter.b3d_binary_panels import extract_panel_pairs_from_binary


def test_extract_panel_pairs_from_binary():
    payload = b"\x00" * 32
    payload += struct.pack("<dd", 800.0, 600.0)
    payload += struct.pack("<d", 18.0)
    payload += b"\x00" * 32
    payload += struct.pack("<dd", 1200.0, 400.0)
    payload += struct.pack("<d", 18.0)
    payload += b"\x00" * 32
    payload += struct.pack("<dd", 1896.0, 991.0)
    payload += struct.pack("<d", 18.0)

    panels = extract_panel_pairs_from_binary(payload, min_panels=2)
    assert len(panels) >= 2
    sizes = {(int(p.width), int(p.height)) for p in panels}
    assert (800, 600) in sizes

import struct

from b3d_converter.numeric_scanner import scan_float64_candidates


def test_float64_scan():
    data = b"abc" + struct.pack("<d", 2800.0) + b"def"
    nums = scan_float64_candidates(data)

    assert any(abs(n.value - 2800.0) < 0.001 for n in nums)

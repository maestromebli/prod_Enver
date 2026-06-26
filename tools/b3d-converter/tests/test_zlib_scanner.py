import zlib

from b3d_converter.zlib_scanner import scan_zlib_blocks


def test_scan_zlib_blocks():
    payload = b"hello b3d geometry fields X Y Z TriData" * 10
    data = b"prefix" + zlib.compress(payload) + b"suffix"

    blocks = scan_zlib_blocks(data)

    assert len(blocks) >= 1
    assert payload in blocks[0].data

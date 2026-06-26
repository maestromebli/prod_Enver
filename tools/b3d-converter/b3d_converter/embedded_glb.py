from __future__ import annotations

import struct
from typing import Optional

GLB_MAGIC = 0x46546C67


def _try_extract_glb_at(data: bytes, offset: int) -> Optional[bytes]:
    if offset < 0 or len(data) < offset + 12:
        return None
    if struct.unpack_from("<I", data, offset)[0] != GLB_MAGIC:
        return None

    declared = struct.unpack_from("<I", data, offset + 8)[0]
    if declared >= 12 and offset + declared <= len(data):
        return data[offset : offset + declared]

    if len(data) >= offset + 20:
        json_len = struct.unpack_from("<I", data, offset + 12)[0]
        if 0 < json_len < len(data):
            json_pad = (json_len + 3) & ~3
            bin_header = offset + 12 + 8 + json_pad
            if bin_header + 8 <= len(data):
                bin_len = struct.unpack_from("<I", data, bin_header)[0]
                bin_pad = (bin_len + 3) & ~3
                total = bin_header + 8 + bin_pad - offset
                if total > 12 and offset + total <= len(data):
                    return data[offset : offset + total]

    return None


def find_embedded_glb(data: bytes, max_scan: int = 8_000_000) -> Optional[bytes]:
    """Шукає вбудований GLB у бінарному .b3d (як Node findEmbeddedGlb)."""
    limit = min(len(data) - 12, max_scan)
    for i in range(0, limit + 1):
        if i > 0 and i % 4 != 0:
            continue
        chunk = _try_extract_glb_at(data, i)
        if chunk:
            return chunk
    return None


def is_glb_buffer(data: bytes) -> bool:
    return len(data) >= 12 and struct.unpack_from("<I", data, 0)[0] == GLB_MAGIC

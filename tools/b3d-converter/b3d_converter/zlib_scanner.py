from __future__ import annotations

import hashlib
import zlib
from dataclasses import dataclass

from .signatures import ZLIB_SIGNATURES
from .types import ZlibBlock


@dataclass
class DecompressedBlock:
    meta: ZlibBlock
    data: bytes


def scan_zlib_blocks(data: bytes, max_blocks: int = 50) -> list[DecompressedBlock]:
    results: list[DecompressedBlock] = []
    seen_offsets: set[int] = set()

    for sig in ZLIB_SIGNATURES:
        start = 0
        while True:
            offset = data.find(sig, start)
            if offset == -1:
                break

            start = offset + 1

            if offset in seen_offsets:
                continue
            seen_offsets.add(offset)

            try:
                decompressed = zlib.decompress(data[offset:])
            except Exception:
                continue

            sha1 = hashlib.sha1(decompressed).hexdigest()
            results.append(
                DecompressedBlock(
                    meta=ZlibBlock(
                        offset=offset,
                        compressed_size=None,
                        decompressed_size=len(decompressed),
                        data_sha1=sha1,
                    ),
                    data=decompressed,
                )
            )

            if len(results) >= max_blocks:
                break

        if len(results) >= max_blocks:
            break

    results.sort(key=lambda item: item.meta.decompressed_size, reverse=True)
    return results

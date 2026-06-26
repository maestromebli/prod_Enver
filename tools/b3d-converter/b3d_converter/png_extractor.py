from __future__ import annotations

import struct
from pathlib import Path
from typing import Optional

from .signatures import PNG_IEND, PNG_SIGNATURE
from .types import PngPreview


def extract_png_preview(data: bytes, out_path: str | Path | None = None) -> Optional[PngPreview]:
    start = data.find(PNG_SIGNATURE)
    if start == -1:
        return None

    end = data.find(PNG_IEND, start)
    if end == -1:
        return None

    end += len(PNG_IEND)
    png_bytes = data[start:end]

    width = None
    height = None

    try:
        width = struct.unpack(">I", png_bytes[16:20])[0]
        height = struct.unpack(">I", png_bytes[20:24])[0]
    except Exception:
        pass

    saved_path = None
    if out_path:
        out = Path(out_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(png_bytes)
        saved_path = str(out)

    return PngPreview(
        offset=start,
        length=len(png_bytes),
        width=width,
        height=height,
        path=saved_path,
    )

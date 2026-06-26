from __future__ import annotations

import json
import struct
from typing import Any, Optional

ENVER3_MAGIC = b"ENVER3"


def extract_enver3_assembly(data: bytes) -> Optional[dict[str, Any]]:
    """Хвіст ENVER3 у кінці GibLab .b3d (скрипт Базіс)."""
    idx = data.rfind(ENVER3_MAGIC)
    if idx < 0 or idx + 14 > len(data):
        return None

    version = struct.unpack_from("<I", data, idx + 6)[0]
    if version != 1:
        return None

    json_len = struct.unpack_from("<I", data, idx + 10)[0]
    if json_len <= 0 or json_len > 50_000_000 or idx + 14 + json_len > len(data):
        return None

    try:
        payload = data[idx + 14 : idx + 14 + json_len].decode("utf-8")
        parsed = json.loads(payload)
        if parsed.get("panels"):
            return parsed
    except Exception:
        return None

    return None

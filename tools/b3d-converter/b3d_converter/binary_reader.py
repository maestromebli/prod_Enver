from __future__ import annotations

import struct
from pathlib import Path


class BinaryReader:
    def __init__(self, data: bytes):
        self.data = data

    @classmethod
    def from_file(cls, path: str | Path) -> "BinaryReader":
        return cls(Path(path).read_bytes())

    @property
    def size(self) -> int:
        return len(self.data)

    def slice(self, offset: int, length: int) -> bytes:
        return self.data[offset : offset + length]

    def find_all(self, signature: bytes) -> list[int]:
        offsets: list[int] = []
        start = 0
        while True:
            idx = self.data.find(signature, start)
            if idx == -1:
                break
            offsets.append(idx)
            start = idx + 1
        return offsets

    def read_u32le(self, offset: int) -> int:
        return struct.unpack_from("<I", self.data, offset)[0]

    def read_i32le(self, offset: int) -> int:
        return struct.unpack_from("<i", self.data, offset)[0]

    def read_f32le(self, offset: int) -> float:
        return struct.unpack_from("<f", self.data, offset)[0]

    def read_f64le(self, offset: int) -> float:
        return struct.unpack_from("<d", self.data, offset)[0]

    def magic_ascii(self, length: int = 16) -> str:
        raw = self.data[:length]
        return "".join(chr(b) if 32 <= b < 127 else "." for b in raw)

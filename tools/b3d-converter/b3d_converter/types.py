from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass
class BinaryRange:
    offset: int
    length: int
    label: str


@dataclass
class PngPreview:
    offset: int
    length: int
    width: int | None = None
    height: int | None = None
    path: str | None = None


@dataclass
class ZlibBlock:
    offset: int
    compressed_size: int | None
    decompressed_size: int
    data_sha1: str
    label: str = "zlib"


@dataclass
class ZlibPayloadAnalysis:
    offset: int
    decompressed_size: int
    data_sha1: str
    important_fields: list[str] = field(default_factory=list)
    string_sample: list[str] = field(default_factory=list)
    numeric_summary: dict[str, Any] = field(default_factory=dict)
    coordinate_range: dict[str, float] | None = None
    data_start_offset: int | None = None


@dataclass
class FieldDictEntry:
    name: str
    offset: int
    length: int


@dataclass
class FieldDictionary:
    entries: list[FieldDictEntry] = field(default_factory=list)
    data_start_offset: int | None = None
    encoding: str = "ascii"


@dataclass
class StringHit:
    value: str
    offset: int
    encoding: str
    context: str | None = None


@dataclass
class NumericCandidate:
    offset: int
    value: float
    dtype: Literal["float32", "float64", "int32"]
    confidence: float = 0.0
    reason: str | None = None


@dataclass
class Vertex:
    x: float
    y: float
    z: float


@dataclass
class Triangle:
    a: int
    b: int
    c: int


@dataclass
class MeshCandidate:
    name: str
    vertices: list[Vertex] = field(default_factory=list)
    triangles: list[Triangle] = field(default_factory=list)
    confidence: float = 0.0
    source: str = "unknown"
    notes: list[str] = field(default_factory=list)


@dataclass
class BoundingBox:
    min_x: float
    min_y: float
    min_z: float
    max_x: float
    max_y: float
    max_z: float

    @property
    def width(self) -> float:
        return self.max_x - self.min_x

    @property
    def depth(self) -> float:
        return self.max_y - self.min_y

    @property
    def height(self) -> float:
        return self.max_z - self.min_z


@dataclass
class PanelSpec:
    width: float
    height: float
    depth: float
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    label: str = "panel"


@dataclass
class ProjectPanel:
    code: str
    length_mm: float
    width_mm: float
    thickness_mm: float = 18.0
    part_name: str = ""


@dataclass
class PositionedPanel:
    """Панель для GLB (позиція в метрах, glTF Y-up)."""
    code: str
    translation: tuple[float, float, float]
    scale: tuple[float, float, float]
    rotation: tuple[float, float, float, float] | None = None


@dataclass
class B3DReport:
    input_path: str
    file_size: int
    magic: str | None
    png_preview: PngPreview | None = None
    zlib_blocks: list[ZlibBlock] = field(default_factory=list)
    zlib_analyses: list[ZlibPayloadAnalysis] = field(default_factory=list)
    field_dictionary: FieldDictionary | None = None
    string_hits: list[StringHit] = field(default_factory=list)
    important_fields: list[str] = field(default_factory=list)
    numeric_candidates: list[NumericCandidate] = field(default_factory=list)
    mesh_candidates: list[MeshCandidate] = field(default_factory=list)
    panel_specs: list[PanelSpec] = field(default_factory=list)
    bounding_box: BoundingBox | None = None
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

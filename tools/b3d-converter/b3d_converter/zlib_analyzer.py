from __future__ import annotations

from .numeric_scanner import (
    estimate_bounding_box_from_numbers,
    scan_float32_candidates,
    scan_float64_candidates,
    summarize_numeric_values,
)
from .string_table import extract_ascii_strings, extract_utf16le_strings, find_important_fields
from .types import ZlibPayloadAnalysis
from .zlib_scanner import DecompressedBlock


def analyze_zlib_payload(block: DecompressedBlock, index: int) -> ZlibPayloadAnalysis:
    data = block.data
    strings = extract_ascii_strings(data) + extract_utf16le_strings(data)
    important = find_important_fields(strings)

    f64 = scan_float64_candidates(data, max_results=5000, step=4)
    f32 = scan_float32_candidates(data, max_results=10000, step=4)
    numeric = sorted(f64 + f32, key=lambda n: n.confidence, reverse=True)

    string_sample = sorted({s.value for s in strings if len(s.value) >= 2})[:200]

    bbox = estimate_bounding_box_from_numbers(numeric)
    coordinate_range = None
    if bbox:
        coordinate_range = {
            "min_x": bbox.min_x,
            "min_y": bbox.min_y,
            "min_z": bbox.min_z,
            "max_x": bbox.max_x,
            "max_y": bbox.max_y,
            "max_z": bbox.max_z,
        }

    data_start = None
    for s in strings:
        if s.value == "TriData" or s.value == "Elements":
            data_start = s.offset
            break

    return ZlibPayloadAnalysis(
        offset=block.meta.offset,
        decompressed_size=block.meta.decompressed_size,
        data_sha1=block.meta.data_sha1,
        important_fields=important,
        string_sample=string_sample,
        numeric_summary=summarize_numeric_values(numeric),
        coordinate_range=coordinate_range,
        data_start_offset=data_start,
    )

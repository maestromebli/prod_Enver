from __future__ import annotations

from .dictionary_parser import analyze_dictionary
from .numeric_scanner import (
    estimate_bounding_box_from_numbers,
    scan_float32_candidates,
    scan_float64_candidates,
    summarize_numeric_values,
)
from .types import ZlibPayloadAnalysis
from .zlib_scanner import DecompressedBlock


def analyze_decompressed_block(block: DecompressedBlock, index: int = 0) -> ZlibPayloadAnalysis:
    """Аналіз одного розпакованого zlib-payload."""
    data = block.data
    dictionary = analyze_dictionary(data)

    f64 = scan_float64_candidates(data, max_results=10000)
    f32 = scan_float32_candidates(data, max_results=20000)
    numeric = sorted(f64 + f32, key=lambda item: item.confidence, reverse=True)

    bbox = estimate_bounding_box_from_numbers(numeric)
    coord_range = None
    if bbox:
        coord_range = {
            "min_x": bbox.min_x,
            "max_x": bbox.max_x,
            "min_y": bbox.min_y,
            "max_y": bbox.max_y,
            "min_z": bbox.min_z,
            "max_z": bbox.max_z,
        }

    return ZlibPayloadAnalysis(
        offset=block.meta.offset,
        decompressed_size=block.meta.decompressed_size,
        data_sha1=block.meta.data_sha1,
        important_fields=dictionary["important_fields"],
        string_sample=[s.value for s in dictionary["strings"][:40]],
        numeric_summary=summarize_numeric_values(numeric[:500]),
        coordinate_range=coord_range,
        data_start_offset=0,
    )

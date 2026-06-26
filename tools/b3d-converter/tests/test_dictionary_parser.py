from b3d_converter.dictionary_parser import analyze_dictionary, find_important_fields
from b3d_converter.types import StringHit


def test_analyze_dictionary_finds_xyz_fields():
    payload = (
        b"MinX\x00MaxX\x00Width\x00Height\x00TriData\x00"
        b"DirX\x00DirY\x00DirZ\x00Contour\x00"
    ) + b"\x00" * 64
    result = analyze_dictionary(payload)
    assert "DirX" in result["important_fields"]
    assert "TriData" in result["important_fields"]
    assert result["dictionary_confidence"] >= 4


def test_find_important_fields_from_hits():
    hits = [
        StringHit(value="Contour", offset=0, encoding="ascii"),
        StringHit(value="Holes", offset=10, encoding="ascii"),
    ]
    found = find_important_fields(hits)
    assert "Contour" in found
    assert "Holes" in found

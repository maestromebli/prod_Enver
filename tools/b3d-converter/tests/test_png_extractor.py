from b3d_converter.png_extractor import extract_png_preview


def test_no_png_returns_none():
    assert extract_png_preview(b"hello world") is None

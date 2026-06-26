PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
PNG_IEND = b"IEND\xaeB`\x82"

ZLIB_SIGNATURES = [
    b"\x78\x01",
    b"\x78\x9c",
    b"\x78\xda",
]

IMPORTANT_ASCII_FIELDS = [
    "ID",
    "X",
    "Y",
    "Z",
    "x",
    "y",
    "z",
    "DirX",
    "DirY",
    "DirZ",
    "MinX",
    "MinY",
    "MinZ",
    "MaxX",
    "MaxY",
    "MaxZ",
    "Width",
    "Height",
    "Depth",
    "Length",
    "Size",
    "Pos1",
    "Pos2",
    "Contour",
    "Hole",
    "Holes",
    "TriData",
    "Materials",
    "Material",
    "Furniture",
    "Drawing",
    "Drawings",
    "Document",
    "Elements",
    "Model",
    "Obj",
    "Objs",
    "Name",
    "Thickness",
    "Edges",
    "Butts",
]

STANDARD_PANEL_THICKNESSES = [16, 18, 19, 22, 25, 36]

from pathlib import Path

from b3d_converter.glb_writer import write_glb
from b3d_converter.panel_builder import create_box_mesh
from b3d_converter.types import BoundingBox


def test_write_glb_creates_file(tmp_path: Path):
    mesh = create_box_mesh(
        BoundingBox(min_x=0, min_y=0, min_z=0, max_x=100, max_y=200, max_z=300),
        name="test_box",
    )
    out = tmp_path / "box.glb"
    write_glb(mesh, out)
    data = out.read_bytes()
    assert data[:4] == b"glTF"
    assert len(data) > 200

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console

from .binary_reader import BinaryReader
from .field_dictionary import find_field_dictionary_in_payloads
from .geometry_detector import (
    detect_interleaved_float32_vertices,
    detect_panel_specs_from_numbers,
    detect_tridata_mesh,
)
from .converter_pipeline import resolve_export_mesh, try_write_embedded_glb, try_write_enver3_assembly_glb
from .glb_writer import write_glb
from .panel_glb_builder import build_panel_preview_glb
from .numeric_scanner import (
    estimate_bounding_box_from_numbers,
    extract_axis_bounding_box,
    scan_float32_candidates,
    scan_float64_candidates,
    summarize_numeric_values,
)
from .png_extractor import extract_png_preview
from .report import save_report, write_debug_artifacts
from .string_table import extract_ascii_strings, extract_utf16le_strings, find_important_fields
from .types import B3DReport
from .zlib_analyzer import analyze_zlib_payload
from .zlib_scanner import scan_zlib_blocks

app = typer.Typer(no_args_is_help=True)
console = Console()


def inspect_b3d(
    input_path: Path,
    preview_out: Optional[Path] = None,
    debug_dir: Optional[Path] = None,
) -> tuple[B3DReport, list[bytes]]:
    reader = BinaryReader.from_file(input_path)
    data = reader.data

    report = B3DReport(
        input_path=str(input_path),
        file_size=reader.size,
        magic=reader.magic_ascii(16),
    )

    if not data.startswith(b"BZ85"):
        report.warnings.append(
            "File does not start with expected BZ85 magic. Continue with heuristic scan."
        )

    preview = extract_png_preview(data, preview_out)
    report.png_preview = preview

    zblocks = scan_zlib_blocks(data)
    report.zlib_blocks = [z.meta for z in zblocks]
    report.zlib_analyses = [analyze_zlib_payload(z, i) for i, z in enumerate(zblocks)]

    decompressed_payloads = [z.data for z in zblocks]
    scan_sources = [data] + decompressed_payloads

    all_strings = []
    for source in scan_sources:
        all_strings.extend(extract_ascii_strings(source))
        all_strings.extend(extract_utf16le_strings(source))

    report.string_hits = all_strings[:5000]
    report.important_fields = find_important_fields(all_strings)

    report.field_dictionary = find_field_dictionary_in_payloads(decompressed_payloads or [data])

    has_tridata = "TriData" in report.important_fields
    has_minmax = all(
        f in report.important_fields for f in ("MinX", "MaxX", "MinY", "MaxY", "MinZ", "MaxZ")
    )

    numeric_source = zblocks[0].data if zblocks else data

    f64 = scan_float64_candidates(numeric_source, max_results=20000)
    f32 = scan_float32_candidates(numeric_source, max_results=50000)

    numeric = sorted(f64 + f32, key=lambda n: n.confidence, reverse=True)
    report.numeric_candidates = numeric[:2000]

    bbox = estimate_bounding_box_from_numbers(numeric)
    if has_minmax:
        axis_bbox = extract_axis_bounding_box(numeric)
        if axis_bbox:
            bbox = axis_bbox
    report.bounding_box = bbox

    dim_values = [n.value for n in numeric if 50 <= abs(n.value) <= 4000]
    report.panel_specs = detect_panel_specs_from_numbers(dim_values)

    report.metadata["numeric_summary"] = summarize_numeric_values(numeric)
    report.metadata["zlib_blocks_count"] = len(zblocks)
    report.metadata["sha1"] = hashlib.sha1(data).hexdigest()
    report.metadata["has_tridata"] = has_tridata
    report.metadata["has_minmax"] = has_minmax

    mesh_candidates = []
    for idx, payload in enumerate(decompressed_payloads):
        detected = detect_interleaved_float32_vertices(payload, has_tridata=has_tridata)
        for item in detected:
            item.source = f"zlib_block_{idx}:{item.source}"
        mesh_candidates.extend(detected)

        if has_tridata:
            tridata_offset = payload.find(b"TriData")
            if tridata_offset >= 0:
                tridata_mesh = detect_tridata_mesh(
                    payload,
                    tridata_offset,
                    has_minmax_fields=has_minmax,
                )
                if tridata_mesh:
                    tridata_mesh.source = f"zlib_block_{idx}:{tridata_mesh.source}"
                    mesh_candidates.append(tridata_mesh)

    report.mesh_candidates = sorted(
        mesh_candidates,
        key=lambda c: (c.confidence, len(c.vertices), len(c.triangles)),
        reverse=True,
    )[:20]

    if not report.mesh_candidates:
        report.warnings.append(
            "No reliable triangle mesh found. Converter may produce fallback bounding box only."
        )

    if debug_dir:
        write_debug_artifacts(report, decompressed_payloads, numeric_source, debug_dir)

    return report, decompressed_payloads


@app.command()
def inspect(
    input: Path = typer.Argument(..., help="Input .b3d file"),
    out: Path = typer.Option(Path("out/report.json"), help="Output JSON report"),
    preview: Path = typer.Option(Path("out/preview.png"), help="Output PNG preview"),
    debug: Optional[Path] = typer.Option(None, help="Debug artifacts directory"),
):
    debug_dir = debug or out.parent
    report, _ = inspect_b3d(input, preview, debug_dir=debug_dir)
    save_report(report, out)
    console.print(f"[green]Report saved:[/green] {out}")

    if report.png_preview:
        console.print(f"[green]Preview extracted:[/green] {preview}")
    else:
        console.print("[yellow]No PNG preview found[/yellow]")

    console.print(f"Magic: {report.magic}")
    console.print(f"File size: {report.file_size}")
    console.print(f"Zlib blocks: {len(report.zlib_blocks)}")
    console.print(f"Important fields: {', '.join(report.important_fields[:50])}")


@app.command("extract-preview")
def extract_preview(
    input: Path = typer.Argument(...),
    out: Path = typer.Option(Path("out/preview.png")),
):
    data = input.read_bytes()
    preview = extract_png_preview(data, out)

    if not preview:
        console.print("[red]No PNG preview found[/red]")
        raise typer.Exit(code=1)

    console.print(f"[green]Preview saved:[/green] {out}")
    console.print(
        f"Offset: {preview.offset}, length: {preview.length}, size: {preview.width}x{preview.height}"
    )


@app.command()
def convert(
    input: Path = typer.Argument(..., help="Input .b3d file"),
    out: Path = typer.Option(Path("out/model.glb"), help="Output .glb"),
    report_out: Path = typer.Option(Path("out/report.json"), help="Output report JSON"),
    preview: Path = typer.Option(Path("out/preview.png"), help="Output preview PNG"),
    debug: Optional[Path] = typer.Option(None, help="Debug artifacts directory"),
):
    debug_dir = debug or out.parent
    report, payloads = inspect_b3d(input, preview, debug_dir=debug_dir)
    raw = input.read_bytes()

    embedded_source = try_write_embedded_glb(raw, payloads, out)
    if embedded_source:
        report.metadata["glb_output"] = str(out)
        report.metadata["glb_output_kind"] = "READY"
        report.metadata["glb_source"] = embedded_source
        report.metadata["glb_is_fallback"] = False
        save_report(report, report_out)
        console.print(f"[green]Embedded GLB saved:[/green] {out}")
        return

    enver3_source, panel_count = try_write_enver3_assembly_glb(raw, payloads, out)
    if enver3_source:
        report.metadata["glb_output"] = str(out)
        report.metadata["glb_output_kind"] = "READY"
        report.metadata["glb_source"] = enver3_source
        report.metadata["panel_count"] = panel_count
        report.metadata["layout"] = "assembly"
        report.metadata["glb_is_fallback"] = False
        save_report(report, report_out)
        console.print(f"[green]Bazis ENVER3 assembly GLB saved ({panel_count} panels):[/green] {out}")
        return

    mesh, output_kind, panels = resolve_export_mesh(report, payloads, raw)

    if mesh is None:
        report.errors.append("Cannot create GLB: no mesh and no bounding box fallback.")
        save_report(report, report_out)
        console.print("[red]Cannot create GLB. See report.[/red]")
        raise typer.Exit(code=2)

    report.metadata["panel_count"] = len(panels)

    try:
        if output_kind == "FALLBACK_READY" and panels and len(panels) >= 2:
            blob = build_panel_preview_glb(panels)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(blob)
        else:
            write_glb(mesh, out)
        report.metadata["glb_output"] = str(out)
        report.metadata["glb_mesh_name"] = mesh.name
        report.metadata["glb_mesh_confidence"] = mesh.confidence
        report.metadata["glb_output_kind"] = output_kind
        report.metadata["glb_is_fallback"] = output_kind == "FALLBACK_READY"

        if output_kind == "FALLBACK_READY":
            report.warnings.append(
                "GLB is experimental fallback geometry, not exact furniture model."
            )
            console.print(f"[yellow]Fallback GLB saved (not exact geometry):[/yellow] {out}")
        else:
            console.print(f"[green]GLB saved:[/green] {out}")
    except Exception as exc:
        report.errors.append(f"GLB export failed: {exc}")
        console.print(f"[red]GLB export failed:[/red] {exc}")
        save_report(report, report_out)
        raise typer.Exit(code=3)

    save_report(report, report_out)
    console.print(f"[green]Report saved:[/green] {report_out}")


if __name__ == "__main__":
    app()

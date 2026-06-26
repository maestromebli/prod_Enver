from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console

from .cli import inspect_b3d
from .converter_pipeline import resolve_export_mesh, try_write_embedded_glb, try_write_enver3_assembly_glb
from .glb_writer import write_glb
from .panel_glb_builder import build_panel_preview_glb
from .report import save_report

console = Console()


def main(
    input: Path = typer.Option(..., "--input"),
    output: Path = typer.Option(..., "--output"),
    report: Path = typer.Option(..., "--report"),
    preview: Path = typer.Option(..., "--preview"),
) -> None:
    b3d_report, payloads = inspect_b3d(input, preview, debug_dir=report.parent)
    raw = input.read_bytes()

    embedded = try_write_embedded_glb(raw, payloads, output)
    if embedded:
        b3d_report.metadata["worker_status"] = "READY"
        b3d_report.metadata["output"] = str(output)
        b3d_report.metadata["glb_source"] = embedded
        save_report(b3d_report, report)
        console.print("READY")
        return

    enver3_source, panel_count = try_write_enver3_assembly_glb(raw, payloads, output)
    if enver3_source:
        b3d_report.metadata["worker_status"] = "READY"
        b3d_report.metadata["output"] = str(output)
        b3d_report.metadata["glb_source"] = enver3_source
        b3d_report.metadata["panel_count"] = panel_count
        b3d_report.metadata["layout"] = "assembly"
        save_report(b3d_report, report)
        console.print("READY")
        return

    mesh, output_kind, panels = resolve_export_mesh(b3d_report, payloads, raw)

    if mesh is None:
        b3d_report.errors.append("Worker failed: no mesh candidate or fallback bbox.")
        save_report(b3d_report, report)
        console.print("[red]FAILED[/red]")
        raise typer.Exit(code=2)

    try:
        if mesh.name == "panel_preview" and panels:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(build_panel_preview_glb(panels))
        else:
            write_glb(mesh, output)
        b3d_report.metadata["worker_status"] = (
            "PARTIAL_READY" if output_kind == "FALLBACK_READY" else "READY"
        )
        b3d_report.metadata["output"] = str(output)
        b3d_report.metadata["glb_mesh_confidence"] = mesh.confidence
        b3d_report.metadata["glb_is_fallback"] = output_kind == "FALLBACK_READY"
        b3d_report.metadata["panel_count"] = len(panels)
    except Exception as exc:
        b3d_report.metadata["worker_status"] = "FAILED"
        b3d_report.errors.append(str(exc))
        save_report(b3d_report, report)
        console.print("[red]FAILED[/red]")
        raise typer.Exit(code=3)

    save_report(b3d_report, report)
    console.print(b3d_report.metadata["worker_status"])


if __name__ == "__main__":
    typer.run(main)

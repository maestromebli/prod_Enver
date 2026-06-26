from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from .types import B3DReport


def save_report(report: B3DReport, out_path: str | Path) -> None:
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    data = asdict(report)

    if data.get("numeric_candidates") and len(data["numeric_candidates"]) > 500:
        data["numeric_candidates_sample"] = data["numeric_candidates"][:500]
        data["numeric_candidates_count"] = len(data["numeric_candidates"])
        data["numeric_candidates"] = data["numeric_candidates_sample"]

    if data.get("mesh_candidates"):
        data["mesh_candidates"] = [
            {
                "name": m["name"],
                "vertex_count": len(m.get("vertices") or []),
                "triangle_count": len(m.get("triangles") or []),
                "confidence": m.get("confidence"),
                "source": m.get("source"),
                "notes": m.get("notes"),
            }
            for m in data["mesh_candidates"]
        ]

    if data.get("string_hits") and len(data["string_hits"]) > 1000:
        data["string_hits_sample"] = data["string_hits"][:1000]
        data["string_hits_count"] = len(data["string_hits"])
        data["string_hits"] = data["string_hits_sample"]

    out.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def write_debug_artifacts(
    report: B3DReport,
    decompressed_payloads: list[bytes],
    numeric_source: bytes,
    out_dir: str | Path,
) -> None:
    """Зберігає додаткові debug-артефакти для reverse-engineering."""
    base = Path(out_dir)
    base.mkdir(parents=True, exist_ok=True)

    for idx, payload in enumerate(decompressed_payloads[:5]):
        (base / f"decompressed_{idx}.bin").write_bytes(payload)

    strings_path = base / "strings.txt"
    lines = [f"{s.offset}\t{s.encoding}\t{s.value}" for s in report.string_hits[:5000]]
    strings_path.write_text("\n".join(lines), encoding="utf-8")

    numbers_path = base / "numbers.csv"
    csv_lines = ["offset,dtype,value,confidence,reason"]
    for n in report.numeric_candidates[:5000]:
        reason = (n.reason or "").replace(",", ";")
        csv_lines.append(f"{n.offset},{n.dtype},{n.value},{n.confidence},{reason}")
    numbers_path.write_text("\n".join(csv_lines), encoding="utf-8")

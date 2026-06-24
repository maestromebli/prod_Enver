/** Підсумок перевірки пакета конструктива (XLS/PDF/3D). */

function normMaterial(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function buildConstructiveReviewSummary(detail) {
  const files = detail?.files || [];
  const parts = detail?.parts || [];
  const materials = detail?.materials || [];
  const hardware = detail?.hardware || [];
  const unmapped = detail?.unmappedParts || parts.filter((p) => !p.modelNodeId && !p.modelMeshName);

  const pdfFile = files.find((f) => f.kind === "assembly_pdf") || null;
  const xlsFile = files.find((f) => f.kind === "spec_xls") || null;
  const glbFile = files.find((f) => f.kind === "glb_model" || f.kind === "gltf_model") || null;
  const b3dFile = files.find((f) => f.kind === "b3d") || null;

  const warnings = [];
  const checks = [];

  checks.push({
    key: "pdf",
    ok: Boolean(pdfFile),
    label: "PDF складальне креслення",
    detail: pdfFile?.originalName || "відсутній"
  });
  checks.push({
    key: "xls",
    ok: Boolean(xlsFile),
    label: "XLS специфікація",
    detail: xlsFile?.originalName || "відсутній"
  });
  checks.push({
    key: "parts",
    ok: parts.length > 0,
    label: "Розібрані деталі",
    detail: `${parts.length} шт.`
  });
  checks.push({
    key: "materials",
    ok: materials.length > 0,
    label: "Матеріали зі специфікації",
    detail: `${materials.length} поз.`
  });
  checks.push({
    key: "hardware",
    ok: hardware.length > 0,
    label: "Фурнітура",
    detail: `${hardware.length} поз.`
  });
  checks.push({
    key: "3d",
    ok: Boolean(glbFile) || unmapped.length === 0,
    label: "3D модель / мапінг",
    detail: glbFile
      ? `${parts.length - unmapped.length}/${parts.length} зі звʼязком`
      : b3dFile
        ? "B3D без GLB — потрібен експорт"
        : unmapped.length
          ? `${unmapped.length} без 3D`
          : "немає GLB"
  });

  if (!pdfFile) warnings.push("Немає PDF складального креслення");
  if (!xlsFile) warnings.push("Немає XLS специфікації");
  if (parts.length === 0 && (pdfFile || xlsFile)) {
    warnings.push("Файли є, але деталі не розібрані — натисніть «Розібрати»");
  }
  if (unmapped.length > 0) {
    warnings.push(`${unmapped.length} деталей без 3D-звʼязку`);
  }
  if (b3dFile && !glbFile) {
    warnings.push("B3D збережено, але для перегляду потрібен GLB/GLTF");
  }

  const specMaterialNames = new Set(
    materials.map((m) => normMaterial(m.materialName)).filter(Boolean)
  );
  const partMaterialNames = [
    ...new Set(parts.map((p) => normMaterial(p.material)).filter(Boolean))
  ];
  const orphanPartMaterials = partMaterialNames.filter(
    (m) =>
      !specMaterialNames.has(m) &&
      !Array.from(specMaterialNames).some((s) => s.includes(m) || m.includes(s))
  );
  if (orphanPartMaterials.length) {
    warnings.push(
      `Матеріали деталей не знайдені в XLS: ${orphanPartMaterials.slice(0, 3).join(", ")}${orphanPartMaterials.length > 3 ? "…" : ""}`
    );
  }

  const blockCodes = [...new Set(parts.map((p) => p.blockCode).filter(Boolean))];
  const readyForReview =
    parts.length > 0 &&
    (pdfFile || xlsFile) &&
    ["parsed", "needs_review", "approved_by_constructor"].includes(detail?.package?.status || "");

  return {
    files: { pdf: pdfFile, xls: xlsFile, glb: glbFile, b3d: b3dFile },
    counts: {
      parts: parts.length,
      materials: materials.length,
      hardware: hardware.length,
      unmapped3d: unmapped.length,
      blocks: blockCodes.length
    },
    blockCodes,
    checks,
    warnings,
    orphanPartMaterials,
    readyForReview,
    needsReview: detail?.package?.status === "needs_review" || warnings.length > 0
  };
}

/** Чеклист готовності пакета конструктива до автопередачі в цех. */

export function evaluatePackageReadiness(detail = {}) {
  const files = Array.isArray(detail.files) ? detail.files : [];
  const parts = Array.isArray(detail.parts) ? detail.parts : [];
  const preview3d = detail.preview3d || detail.manifest?.manifestJson?.preview3d || null;

  const hasProject = files.some((f) => f.kind === "project");
  const hasB3d = files.some((f) => f.kind === "b3d");
  const hasXls = files.some((f) => f.kind === "spec_xls");
  const partsCount = parts.length;

  const enver3Applied = Boolean(
    preview3d?.enver3Sync?.applied ||
    preview3d?.source === "b3d_enver3_assembly" ||
    preview3d?.source === "assembly_json"
  );
  const enver3PanelCount = Number(preview3d?.enver3Sync?.panelCount) || 0;

  const conversionStatus = String(preview3d?.conversionStatus || preview3d?.status || "").trim();
  const partialB3d =
    conversionStatus === "PARTIAL_READY" || (preview3d?.quality === "partial" && !enver3Applied);

  const unmappedCount = Array.isArray(detail.unmappedParts) ? detail.unmappedParts.length : 0;

  const checks = [
    {
      key: "project",
      label: "Файл .project",
      ok: hasProject,
      required: true
    },
    {
      key: "b3d",
      label: "Файл .b3d",
      ok: hasB3d,
      required: true
    },
    {
      key: "xls",
      label: "Специфікація XLS",
      ok: hasXls,
      required: false
    },
    {
      key: "parts",
      label: "Розібрані деталі",
      ok: partsCount > 0,
      required: true,
      hint: partsCount ? `${partsCount} деталей` : "Запустіть розбір пакета"
    },
    {
      key: "enver3",
      label: "ENVER3 у .b3d (збірка)",
      ok: enver3Applied,
      required: false,
      hint: enver3Applied
        ? enver3PanelCount
          ? `${enver3PanelCount} панелей`
          : "Є"
        : "Скрипт enver-b3d-assembly-export.js у Базісі"
    },
    {
      key: "b3d_quality",
      label: "3D без PARTIAL_READY",
      ok: !partialB3d,
      required: false,
      hint: partialB3d ? "Експериментальна геометрія — потрібен ENVER3" : "OK"
    },
    {
      key: "mapping",
      label: "3D-звʼязок деталей",
      ok: unmappedCount === 0 || partsCount === 0,
      required: false,
      hint: unmappedCount ? `${unmappedCount} без звʼязку` : "OK"
    }
  ];

  const requiredFailed = checks.filter((c) => c.required && !c.ok);
  const readyForAutoHandoff =
    requiredFailed.length === 0 && !partialB3d && (enver3Applied || partsCount > 0);

  return {
    checks,
    readyForAutoHandoff,
    hasEnver3: enver3Applied,
    partialB3d,
    partsCount,
    blockReason: requiredFailed[0]?.label || (partialB3d ? "PARTIAL_READY 3D" : "")
  };
}

export function packageReadinessScore(readiness) {
  if (!readiness?.checks?.length) return 0;
  const scored = readiness.checks.filter((c) => c.required || c.ok);
  const ok = scored.filter((c) => c.ok).length;
  return Math.round((ok / scored.length) * 100);
}

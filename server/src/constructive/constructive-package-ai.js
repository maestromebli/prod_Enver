import { getPackageDetail, getPackageParts } from "./constructive-package-service.js";
import { getAiSettings } from "../app-settings.js";
import { callOpenAiChat } from "../ai/openai-client.js";
import { parseRawAnalysisContent } from "../ai/validate-analysis.js";

function buildPackageAiPrompt({ orderNumber, item, packageDetail }) {
  const parts = packageDetail.parts || [];
  const materials = packageDetail.materials || [];
  const hardware = packageDetail.hardware || [];
  const files = packageDetail.files || [];

  return `Ти аналізуєш пакет конструктива ENVER для меблевого виробництва.
Замовлення: ${orderNumber || "—"}, позиція: ${item || "—"}.
Статус пакета: ${packageDetail.package?.status || "—"}.

Файли: ${files.map((f) => `${f.kindLabel}: ${f.originalName}`).join("; ") || "—"}
Деталей: ${parts.length}, матеріалів: ${materials.length}, фурнітури: ${hardware.length}
Unmapped 3D: ${packageDetail.unmappedParts?.length || 0}

Поверни ТІЛЬКИ валідний JSON:
{
  "detectedBlocks": [],
  "detectedParts": [{"partNo":"","partName":"","material":""}],
  "detectedMaterials": [],
  "detectedHardware": [],
  "procurementDraft": [{"name":"","qty":"","type":"board|hardware|other"}],
  "cncReadiness": {"ready": false, "missing": [], "warnings": []},
  "modelReadiness": {"has3dSource": false, "needsGlbExport": false, "mappedPartsCount": 0, "unmappedParts": []},
  "reviewChecklist": ["..."],
  "warnings": [],
  "suggestedActions": []
}

Правила:
- Не вигадуй дані яких немає у списках нижче.
- Якщо немає GLB/GTLF — modelReadiness.needsGlbExport = true.
- B3D без GLB — не вважай 3D готовим.
- Не пропонуй автоматично відправку на ЧПК, finance, CNC release.
- Усі тексти українською.

Деталі (перші 40):
${JSON.stringify(parts.slice(0, 40), null, 0)}

Матеріали:
${JSON.stringify(materials.slice(0, 20), null, 0)}

Фурнітура:
${JSON.stringify(hardware.slice(0, 20), null, 0)}`;
}

export async function analyzeConstructivePackage(packageId, { orderNumber, item } = {}) {
  const detail = await getPackageDetail(packageId);
  if (!detail) {
    const err = new Error("Пакет не знайдено");
    err.status = 404;
    throw err;
  }

  const settings = await getAiSettings();
  if (!settings.enabled || !settings.apiKey) {
    return {
      available: false,
      analysis: null,
      message: "ШІ не налаштовано"
    };
  }

  const hasGlb = detail.files?.some(
    (f) => f.kind === "glb_model" || f.kind === "gltf_model" || f.kind === "wrl_model"
  );
  const hasB3d = detail.files?.some((f) => f.kind === "b3d");
  const mappedCount = (detail.parts || []).filter((p) => p.modelNodeId || p.modelMeshName).length;

  const prompt = buildPackageAiPrompt({
    orderNumber,
    item,
    packageDetail: detail
  });

  const started = Date.now();
  const raw = await callOpenAiChat({
    apiKey: settings.apiKey,
    model: settings.model,
    messages: [{ role: "user", content: prompt }]
  });
  const parsed = parseRawAnalysisContent(raw.content);
  const analysis = parsed.ok ? parsed.data : {};

  if (!analysis.modelReadiness) {
    analysis.modelReadiness = {
      has3dSource: hasGlb || hasB3d,
      needsGlbExport: hasB3d && !hasGlb,
      mappedPartsCount: mappedCount,
      unmappedParts: (detail.unmappedParts || []).map((p) => p.partName)
    };
  }

  if (!analysis.cncReadiness) {
    const approved = ["approved_by_constructor", "approved_by_production", "cnc_ready"].includes(
      detail.package?.status
    );
    analysis.cncReadiness = {
      ready: approved && hasGlb,
      missing: approved ? [] : ["Потрібне підтвердження пакета"],
      warnings: detail.unmappedParts?.length
        ? [`${detail.unmappedParts.length} деталей без 3D-звʼязку`]
        : []
    };
  }

  return {
    available: true,
    analysis,
    model: settings.model,
    durationMs: Date.now() - started
  };
}

const VISION_MODEL_PREFIXES = ["gpt-4o", "gpt-4.1", "gpt-4-turbo", "o1", "o3", "o4"];

export function supportsVisionModel(model) {
  const m = String(model || "")
    .trim()
    .toLowerCase();
  if (!m) return false;
  return VISION_MODEL_PREFIXES.some((p) => m === p || m.startsWith(`${p}-`));
}

export function resolveVisionModel({ openaiModel, visionModel } = {}) {
  const preferred = String(visionModel || openaiModel || "gpt-4o-mini").trim();
  if (supportsVisionModel(preferred)) return preferred;
  return "gpt-4o-mini";
}

/**
 * @param {string} prompt
 * @param {Array<{ mime?: string, base64: string }>} images
 */
export function buildVisionUserContent(prompt, images = []) {
  const parts = [{ type: "text", text: prompt }];
  for (const img of images) {
    if (!img?.base64) continue;
    const mime = img.mime || "image/jpeg";
    parts.push({
      type: "image_url",
      image_url: {
        url: `data:${mime};base64,${img.base64}`,
        detail: images.length > 2 ? "low" : "high"
      }
    });
  }
  return parts.length > 1 ? parts : prompt;
}

export function buildChatMessages({ system, prompt, images = [] }) {
  const userContent = buildVisionUserContent(prompt, images);
  return [
    { role: "system", content: system },
    { role: "user", content: userContent }
  ];
}

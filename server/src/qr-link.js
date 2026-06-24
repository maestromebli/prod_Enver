import { config } from "./config.js";

/** Deep link для QR — панель оператора з позицією та етапом. */
export function buildOperatorDeepLink({ positionId, stageKey = "cutting", req } = {}) {
  const host = config.domain
    ? `https://${config.domain}`
    : req
      ? `${req.protocol}://${req.get("host")}`
      : "http://localhost:3000";
  const params = new URLSearchParams();
  params.set("position", String(positionId));
  if (stageKey) params.set("stage", stageKey);
  return `${host}/operator.html?${params.toString()}`;
}

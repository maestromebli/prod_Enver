import { getSetting } from "../app-settings.js";

export function getAgentToken() {
  const env = String(process.env.AGENT_TOKEN || "").trim();
  if (env) return env;
  return null;
}

export async function getAgentTokenFromSettings() {
  try {
    const stored = await getSetting("folder_agent", {});
    return String(stored?.token || "").trim() || null;
  } catch {
    return null;
  }
}

export async function resolveAgentToken() {
  return getAgentToken() || (await getAgentTokenFromSettings());
}

export async function requireAgentAuth(req, res, next) {
  const expected = await resolveAgentToken();
  if (!expected) {
    res.status(503).json({ error: "AGENT_TOKEN не налаштовано на сервері" });
    return;
  }
  const header = String(req.headers["x-agent-token"] || "").trim();
  if (header !== expected) {
    res.status(401).json({ error: "Невірний токен агента" });
    return;
  }
  req.agentId = String(req.headers["x-agent-id"] || "default").trim() || "default";
  next();
}

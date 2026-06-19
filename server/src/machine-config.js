import { one, run } from "./db.js";

export const DEFAULT_AI_SOURCE_SUBFOLDERS = ["meta.json", "giblab", "kdt"];

export function parseAiSourceSubfolders(raw) {
  try {
    const arr = JSON.parse(raw || "[]");
    if (!Array.isArray(arr)) return [...DEFAULT_AI_SOURCE_SUBFOLDERS];
    const cleaned = arr.map((s) => String(s || "").trim()).filter(Boolean);
    return cleaned.length ? cleaned : [...DEFAULT_AI_SOURCE_SUBFOLDERS];
  } catch {
    return [...DEFAULT_AI_SOURCE_SUBFOLDERS];
  }
}

export function mapMachineConfigRow(r) {
  if (!r) return null;
  return {
    stageKey: r.stage_key,
    apiUrl: r.api_url || "",
    apiToken: r.api_token ? "••••••••" : "",
    hasToken: Boolean(r.api_token),
    logPath: r.log_path || "",
    logEncoding: r.log_encoding || "utf-8",
    parserProfile: r.parser_profile || "generic",
    watchEnabled: Boolean(r.watch_enabled),
    aiMatchingEnabled: r.ai_matching_enabled !== false,
    projectsRootPath: r.projects_root_path || "",
    aiSourceSubfolders: parseAiSourceSubfolders(r.ai_source_subfolders_json),
    lastProgress: r.last_progress ?? 0,
    lastMatchSummary: r.last_match_summary || "",
    lastMatchConfidence: r.last_match_confidence ?? 0,
    updatedAt: r.updated_at
  };
}

export async function getMachineConfig(stageKey) {
  const row = await one("SELECT * FROM machine_config WHERE stage_key = $1", [stageKey]);
  return mapMachineConfigRow(row);
}

/**
 * @param {string} stageKey
 * @param {object} body
 */
export async function updateMachineConfig(stageKey, body = {}) {
  const {
    apiUrl,
    apiToken,
    clearToken,
    logPath,
    logEncoding,
    parserProfile,
    watchEnabled,
    aiMatchingEnabled,
    projectsRootPath,
    aiSourceSubfolders,
    resetLogOffset
  } = body;

  const existing = await one("SELECT * FROM machine_config WHERE stage_key = $1", [stageKey]);
  if (!existing) {
    const err = new Error("Етап не знайдено");
    err.status = 404;
    throw err;
  }

  let token = existing.api_token;
  if (clearToken) token = "";
  else if (apiToken && apiToken !== "••••••••") token = apiToken;

  const logPathNext = logPath !== undefined ? logPath : existing.log_path;
  const logPathChanged = logPath !== undefined && logPath !== existing.log_path;
  const parserChanged = parserProfile !== undefined && parserProfile !== existing.parser_profile;
  const shouldResetSync = resetLogOffset || logPathChanged || parserChanged;

  const subfoldersJson =
    aiSourceSubfolders !== undefined
      ? JSON.stringify(parseAiSourceSubfolders(aiSourceSubfolders))
      : existing.ai_source_subfolders_json;

  await run(
    `UPDATE machine_config SET
      api_url = @api_url,
      api_token = @api_token,
      log_path = @log_path,
      log_encoding = @log_encoding,
      parser_profile = @parser_profile,
      watch_enabled = @watch_enabled,
      ai_matching_enabled = @ai_matching_enabled,
      projects_root_path = @projects_root_path,
      ai_source_subfolders_json = @ai_source_subfolders_json,
      last_log_offset = CASE WHEN @reset_offset THEN 0 ELSE last_log_offset END,
      last_log_event_time = CASE WHEN @reset_offset THEN '' ELSE last_log_event_time END,
      updated_at = now()
     WHERE stage_key = @stage_key`,
    {
      stage_key: stageKey,
      api_url: apiUrl ?? existing.api_url ?? "",
      api_token: token ?? "",
      log_path: logPathNext ?? "",
      log_encoding: logEncoding ?? existing.log_encoding ?? "utf-8",
      parser_profile: parserProfile ?? existing.parser_profile ?? "generic",
      watch_enabled: watchEnabled !== undefined ? Boolean(watchEnabled) : existing.watch_enabled,
      ai_matching_enabled:
        aiMatchingEnabled !== undefined ? Boolean(aiMatchingEnabled) : existing.ai_matching_enabled,
      projects_root_path:
        projectsRootPath !== undefined ? projectsRootPath : (existing.projects_root_path ?? ""),
      ai_source_subfolders_json: subfoldersJson,
      reset_offset: Boolean(shouldResetSync)
    }
  );

  return getMachineConfig(stageKey);
}

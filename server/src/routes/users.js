import { Router } from "express";
import { all, one, run } from "../db.js";
import { hashPassword } from "../auth-utils.js";
import { requireAdmin, requireAuth, requirePermissionOrAdmin } from "../middleware/auth.js";
import { DEFAULT_PERMISSIONS, ROLES } from "../roles.js";

const router = Router();
router.use(requireAuth);

const PG_UNIQUE_VIOLATION = "23505";

router.get("/machine-config", requirePermissionOrAdmin("canViewMachineLogs"), async (_req, res) => {
  const rows = await all("SELECT * FROM machine_config ORDER BY stage_key");
  res.json(rows.map(mapMachineConfigRow));
});

router.use(requireAdmin);

function mapUser(row) {
  let stages = [];
  try {
    stages = JSON.parse(row.stages_json || "[]");
  } catch {
    stages = [];
  }
  return {
    id: row.id,
    name: row.name,
    login: row.login,
    role: row.role,
    stages,
    active: Boolean(row.active)
  };
}

router.get("/permissions", async (_req, res) => {
  const rows = await all("SELECT role, permissions_json FROM role_permissions");
  const result = { ...DEFAULT_PERMISSIONS };
  for (const row of rows) {
    try {
      result[row.role] = { ...result[row.role], ...JSON.parse(row.permissions_json) };
    } catch {
      /* skip */
    }
  }
  res.json(result);
});

router.put("/permissions", async (req, res) => {
  const body = req.body || {};

  for (const [role, perms] of Object.entries(body)) {
    if (!DEFAULT_PERMISSIONS[role]) continue;
    let toSave = perms;
    if (role === "admin") toSave = { ...perms, ...DEFAULT_PERMISSIONS.admin };
    else if (role === "production") toSave = { ...perms, ...DEFAULT_PERMISSIONS.production };
    await run(
      `INSERT INTO role_permissions (role, permissions_json)
       VALUES ($1, $2)
       ON CONFLICT (role) DO UPDATE SET permissions_json = excluded.permissions_json`,
      [role, JSON.stringify(toSave)]
    );
  }

  const rows = await all("SELECT role, permissions_json FROM role_permissions");
  const result = { ...DEFAULT_PERMISSIONS };
  for (const row of rows) {
    try {
      result[row.role] = { ...result[row.role], ...JSON.parse(row.permissions_json) };
    } catch {
      /* skip */
    }
  }
  res.json(result);
});

function mapMachineConfigRow(r) {
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
    lastProgress: r.last_progress ?? 0,
    lastMatchSummary: r.last_match_summary || "",
    lastMatchConfidence: r.last_match_confidence ?? 0,
    updatedAt: r.updated_at
  };
}

router.put("/machine-config/:stageKey", async (req, res) => {
  const stageKey = req.params.stageKey;
  const {
    apiUrl,
    apiToken,
    clearToken,
    logPath,
    logEncoding,
    parserProfile,
    watchEnabled,
    aiMatchingEnabled,
    resetLogOffset
  } = req.body || {};
  const existing = await one("SELECT * FROM machine_config WHERE stage_key = $1", [stageKey]);
  if (!existing) {
    res.status(404).json({ error: "Етап не знайдено" });
    return;
  }

  let token = existing.api_token;
  if (clearToken) token = "";
  else if (apiToken && apiToken !== "••••••••") token = apiToken;

  const logPathNext = logPath !== undefined ? logPath : existing.log_path;
  const logPathChanged = logPath !== undefined && logPath !== existing.log_path;
  const parserChanged = parserProfile !== undefined && parserProfile !== existing.parser_profile;
  const shouldResetSync = resetLogOffset || logPathChanged || parserChanged;

  await run(
    `UPDATE machine_config SET
      api_url = @api_url,
      api_token = @api_token,
      log_path = @log_path,
      log_encoding = @log_encoding,
      parser_profile = @parser_profile,
      watch_enabled = @watch_enabled,
      ai_matching_enabled = @ai_matching_enabled,
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
      reset_offset: Boolean(shouldResetSync)
    }
  );

  const row = await one("SELECT * FROM machine_config WHERE stage_key = $1", [stageKey]);
  res.json(mapMachineConfigRow(row));
});

router.get("/", async (_req, res) => {
  const rows = await all(
    "SELECT id, name, login, role, stages_json, active FROM users ORDER BY name"
  );
  res.json(rows.map(mapUser));
});

router.post("/", async (req, res) => {
  const { name, login, password, role, stages = [], active = true } = req.body || {};
  if (!name?.trim() || !login?.trim() || !password) {
    res.status(400).json({ error: "Ім'я, логін і пароль обов'язкові" });
    return;
  }
  if (!Object.values(ROLES).includes(role)) {
    res.status(400).json({ error: "Невірна роль" });
    return;
  }

  try {
    const row = await one(
      `INSERT INTO users (name, login, password_hash, role, stages_json, active)
       VALUES (@name, @login, @password_hash, @role, @stages_json, @active)
       RETURNING id, name, login, role, stages_json, active`,
      {
        name: name.trim(),
        login: login.trim(),
        password_hash: hashPassword(password),
        role,
        stages_json: JSON.stringify(Array.isArray(stages) ? stages : []),
        active: Boolean(active)
      }
    );
    res.status(201).json(mapUser(row));
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      res.status(409).json({ error: "Логін уже зайнятий" });
      return;
    }
    throw err;
  }
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await one("SELECT * FROM users WHERE id = $1", [id]);
  if (!existing) {
    res.status(404).json({ error: "Користувача не знайдено" });
    return;
  }

  const { name, login, password, role, stages, active } = req.body || {};
  const updates = {
    name: name?.trim() || existing.name,
    login: login?.trim() || existing.login,
    role: role && Object.values(ROLES).includes(role) ? role : existing.role,
    stages_json: stages !== undefined ? JSON.stringify(stages) : existing.stages_json,
    active: active !== undefined ? Boolean(active) : existing.active,
    password_hash: existing.password_hash
  };

  if (password) {
    updates.password_hash = hashPassword(password);
  }

  try {
    const row = await one(
      `UPDATE users SET name = @name, login = @login, password_hash = @password_hash,
       role = @role, stages_json = @stages_json, active = @active WHERE id = @id
       RETURNING id, name, login, role, stages_json, active`,
      { ...updates, id }
    );
    res.json(mapUser(row));
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      res.status(409).json({ error: "Логін уже зайнятий" });
      return;
    }
    throw err;
  }
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await one("SELECT * FROM users WHERE id = $1", [id]);
  if (!existing) {
    res.status(404).json({ error: "Користувача не знайдено" });
    return;
  }
  if (existing.login === "admin") {
    res.status(400).json({ error: "Неможливо видалити головного адміністратора" });
    return;
  }
  await run("DELETE FROM users WHERE id = $1", [id]);
  res.status(204).send();
});

export default router;

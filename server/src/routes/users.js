import { Router } from "express";
import { all, one, run } from "../db.js";
import { hashPassword } from "../auth-utils.js";
import { requireAdmin, requireAuth, requirePermissionOrAdmin } from "../middleware/auth.js";
import { mapMachineConfigRow, updateMachineConfig } from "../machine-config.js";
import { DEFAULT_PERMISSIONS, ROLES } from "../roles.js";

const router = Router();
router.use(requireAuth);

const PG_UNIQUE_VIOLATION = "23505";

router.get("/machine-config", requirePermissionOrAdmin("canViewMachineLogs"), async (_req, res) => {
  const rows = await all("SELECT * FROM machine_config ORDER BY stage_key");
  res.json(rows.map(mapMachineConfigRow));
});

router.use(requireAdmin);

function mapUserRow(row) {
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

router.put("/machine-config/:stageKey", async (req, res) => {
  try {
    const config = await updateMachineConfig(req.params.stageKey, req.body || {});
    res.json(config);
  } catch (err) {
    if (err.status === 404) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

router.get("/", async (_req, res) => {
  const rows = await all(
    "SELECT id, name, login, role, stages_json, active FROM users ORDER BY name"
  );
  res.json(rows.map(mapUserRow));
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
    res.status(201).json(mapUserRow(row));
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
    res.json(mapUserRow(row));
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

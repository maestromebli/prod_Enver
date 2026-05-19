import crypto from "crypto";
import { one, run } from "./db.js";
import { verifyPassword } from "./auth-utils.js";
import { DEFAULT_PERMISSIONS } from "./roles.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function mapUser(row) {
  if (!row) return null;
  let stages = [];
  try {
    stages = JSON.parse(row.stages_json || "[]");
  } catch {
    stages = [];
  }
  const rolePerms = await one(
    "SELECT permissions_json FROM role_permissions WHERE role = $1",
    [row.role]
  );
  let permissions = { ...(DEFAULT_PERMISSIONS[row.role] || DEFAULT_PERMISSIONS.operator) };
  if (rolePerms?.permissions_json) {
    try {
      permissions = { ...permissions, ...JSON.parse(rolePerms.permissions_json) };
    } catch {
      /* keep defaults */
    }
  }
  // Адміністратор — суперадмін: усі права незалежно від запису в role_permissions
  if (row.role === "admin") {
    permissions = { ...permissions, ...DEFAULT_PERMISSIONS.admin };
  }
  if (row.role === "production") {
    permissions = { ...permissions, ...DEFAULT_PERMISSIONS.production };
  }
  if (row.role === "operator" && stages.length) {
    permissions = { ...permissions, stages };
  }

  return {
    id: row.id,
    name: row.name,
    login: row.login,
    role: row.role,
    stages,
    active: Boolean(row.active),
    permissions
  };
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

export async function createSession(userId) {
  const token = createToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await run(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)`,
    [token, userId, expiresAt]
  );
  return { token, expiresAt };
}

export async function deleteSession(token) {
  if (!token) return;
  await run("DELETE FROM sessions WHERE token = $1", [token]);
}

export async function purgeExpiredSessions() {
  await run(`DELETE FROM sessions WHERE expires_at < now()`);
}

export async function getUserByToken(token) {
  if (!token) return null;
  await purgeExpiredSessions();
  const row = await one(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND u.active = TRUE AND s.expires_at >= now()`,
    [token]
  );
  return mapUser(row);
}

export async function authenticate(login, password) {
  const row = await one(
    "SELECT * FROM users WHERE lower(login) = lower($1) AND active = TRUE",
    [login.trim()]
  );
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return mapUser(row);
}

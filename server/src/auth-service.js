import crypto from "crypto";
import { db } from "./db.js";
import { verifyPassword } from "./auth-utils.js";
import { DEFAULT_PERMISSIONS } from "./roles.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function mapUser(row) {
  if (!row) return null;
  let stages = [];
  try {
    stages = JSON.parse(row.stages_json || "[]");
  } catch {
    stages = [];
  }
  const rolePerms = db.prepare("SELECT permissions_json FROM role_permissions WHERE role = ?").get(row.role);
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

export function createSession(userId) {
  const token = createToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`
  ).run(token, userId, expiresAt);
  return { token, expiresAt };
}

export function deleteSession(token) {
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function purgeExpiredSessions() {
  db.prepare(`DELETE FROM sessions WHERE datetime(expires_at) < datetime('now')`).run();
}

export function getUserByToken(token) {
  if (!token) return null;
  purgeExpiredSessions();
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND u.active = 1 AND datetime(s.expires_at) >= datetime('now')`
    )
    .get(token);
  return mapUser(row);
}

export function authenticate(login, password) {
  const row = db
    .prepare("SELECT * FROM users WHERE lower(login) = lower(?) AND active = 1")
    .get(login.trim());
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return mapUser(row);
}

import { spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function integrationEnabled() {
  if (process.env.RUN_INTEGRATION_TESTS === "0") return false;
  if (process.env.RUN_INTEGRATION_TESTS === "1") return true;
  return Boolean(process.env.DATABASE_URL || process.env.DATABASE_URL_MIGRATIONS);
}

export function runMigrations() {
  if (process.env.CI_INTEGRATION_MIGRATED === "1") return;

  const result = spawnSync("node", ["-r", "dotenv/config", "scripts/migrate.mjs"], {
    cwd: serverRoot,
    env: {
      ...process.env,
      DOTENV_CONFIG_PATH: process.env.DOTENV_CONFIG_PATH || path.resolve(serverRoot, "../.env")
    },
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`migrate failed: ${result.stderr || result.stdout}`);
  }
}

export function listen(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

export async function loginAs(baseUrl, login, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password })
  });
  const body = await res.json();
  if (!res.ok || !body?.data?.token) {
    throw new Error(`login failed: ${JSON.stringify(body)}`);
  }
  return { token: body.data.token, user: body.data.user };
}

export function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export async function cleanupTestOrder(orderNumber) {
  if (!integrationEnabled()) return;
  const { pool } = await import("../../src/db.js");
  if (!pool) return;
  await pool.query("DELETE FROM positions WHERE order_number = $1", [orderNumber]);
  await pool.query("DELETE FROM orders WHERE order_number = $1", [orderNumber]);
}

export async function createTestUser(baseUrl, adminToken, { login, password, role, stages = [] }) {
  const res = await fetch(`${baseUrl}/api/users`, {
    method: "POST",
    headers: authHeaders(adminToken),
    body: JSON.stringify({
      name: `Test ${role}`,
      login,
      password,
      role,
      stages,
      active: true
    })
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`create user failed: ${JSON.stringify(body)}`);
  }
  return body.data ?? body;
}

export async function deleteTestUser(baseUrl, adminToken, userId) {
  if (!userId) return;
  await fetch(`${baseUrl}/api/users/${userId}`, {
    method: "DELETE",
    headers: authHeaders(adminToken)
  });
}

export async function createTestOrder(baseUrl, token, orderNumber) {
  const res = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      orderNumber,
      object: "RBAC test",
      client: "CI",
      manager: "Admin",
      status: "Передано"
    })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`create order failed: ${JSON.stringify(body)}`);
  return body.data;
}

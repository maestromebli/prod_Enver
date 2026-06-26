import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { authHeaders, integrationEnabled, listen, loginAs, runMigrations } from "./helpers.mjs";

const describeIntegration = integrationEnabled() ? describe : describe.skip;

describeIntegration("integration: API surface", () => {
  let server;
  let baseUrl;
  let token;

  before(async () => {
    runMigrations();
    const { createApiApp } = await import("../../src/app.js");
    const app = createApiApp({ dbConfigured: true, dbConnected: true });
    ({ server, baseUrl } = await listen(app));
    const password = process.env.ADMIN_DEFAULT_PASSWORD || "admin";
    ({ token } = await loginAs(baseUrl, "admin", password));
  });

  after(() => {
    server?.close();
  });

  it("GET /api/health — БД підключена", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.database.configured, true);
    assert.equal(body.data.database.connected, true);
  });

  it("GET /api/directories — справочники", async () => {
    const res = await fetch(`${baseUrl}/api/directories`, { headers: authHeaders(token) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.data);
  });

  it("GET /api/kpis — метрики менеджера", async () => {
    const res = await fetch(`${baseUrl}/api/kpis`, { headers: authHeaders(token) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.data);
  });

  it("GET /api/history — журнал змін", async () => {
    const res = await fetch(`${baseUrl}/api/history?limit=5`, { headers: authHeaders(token) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data));
  });

  it("GET /api/settings/ai — налаштування ШІ", async () => {
    const res = await fetch(`${baseUrl}/api/settings/ai`, { headers: authHeaders(token) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok("openaiModel" in body || body.data);
  });

  it("GET /api/users — список користувачів", async () => {
    const res = await fetch(`${baseUrl}/api/users`, { headers: authHeaders(token) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.some((u) => u.login === "admin"));
  });

  it("GET /api/notifications — сповіщення", async () => {
    const res = await fetch(`${baseUrl}/api/notifications`, { headers: authHeaders(token) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.data);
  });

  it("GET /api/production/floor — цех зараз", async () => {
    const res = await fetch(`${baseUrl}/api/production/floor`, { headers: authHeaders(token) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data.stages) || body.data.stages);
  });

  it("GET /api/clients/info — APK meta", async () => {
    const res = await fetch(`${baseUrl}/api/clients/info`, { headers: authHeaders(token) });
    assert.equal(res.status, 200);
    const body = await res.json();
    const info = body.data ?? body;
    assert.equal(typeof info.androidDownloadAvailable, "boolean");
    assert.ok(info.operatorUrl);
  });
});

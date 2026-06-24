import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { authHeaders, integrationEnabled, listen, loginAs, runMigrations } from "./helpers.mjs";

const describeIntegration = integrationEnabled() ? describe : describe.skip;

describeIntegration("integration: auth flow", () => {
  let server;
  let baseUrl;
  let createApiApp;

  before(async () => {
    runMigrations();
    ({ createApiApp } = await import("../../src/app.js"));
    const app = createApiApp({ dbConfigured: true, dbConnected: true });
    ({ server, baseUrl } = await listen(app));
  });

  after(() => {
    server?.close();
  });

  it("login admin → /me → orders list", async () => {
    const password = process.env.ADMIN_DEFAULT_PASSWORD || "admin";
    const { token, user } = await loginAs(baseUrl, "admin", password);
    assert.equal(user.login, "admin");

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: authHeaders(token) });
    assert.equal(me.status, 200);
    const meBody = await me.json();
    assert.equal(meBody.data.user.id, user.id);

    const orders = await fetch(`${baseUrl}/api/orders`, { headers: authHeaders(token) });
    assert.equal(orders.status, 200);
    const ordersBody = await orders.json();
    assert.ok(Array.isArray(ordersBody.data));
  });

  it("невірний пароль — 401", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: "admin", password: "wrong-password-xyz" })
    });
    assert.equal(res.status, 401);
  });
});

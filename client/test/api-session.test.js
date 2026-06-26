import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, setStoredToken } from "../src/api.js";

describe("api session expiry", () => {
  let originalFetch;
  let events;

  before(() => {
    originalFetch = globalThis.fetch;
    events = [];
    const store = new Map();
    globalThis.localStorage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key)
    };
    globalThis.window = {
      location: { origin: "http://localhost:3000", port: "3000" },
      dispatchEvent: (event) => {
        if (event?.type === "enver:session-expired") events.push(event.detail?.message);
        return true;
      }
    };
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    };
    setStoredToken("test-token");
  });

  after(() => {
    globalThis.fetch = originalFetch;
    setStoredToken(null);
  });

  it("401 диспатчить enver:session-expired", async () => {
    events.length = 0;
    globalThis.fetch = async () => ({
      status: 401,
      json: async () => ({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Сесія закінчилась" }
      })
    });

    await assert.rejects(() => api.getOrders(), /Сесія закінчилась/);
    assert.equal(events.length, 1);
    assert.equal(globalThis.localStorage.getItem("enver_token"), null);
  });
});

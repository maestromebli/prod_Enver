import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAccessPositions, isQueryTokenAllowed } from "../src/middleware/auth.js";
import { DEFAULT_PERMISSIONS } from "../../shared/production/permissions.js";

describe("auth permissions", () => {
  it("canAccessPositions — оператор з панеллю цеху", () => {
    const user = {
      role: "operator",
      permissions: { ...DEFAULT_PERMISSIONS.operator, canUseOperatorPanel: true }
    };
    assert.equal(canAccessPositions(user), true);
  });

  it("canAccessPositions — менеджер з замовленнями", () => {
    const user = { role: "manager", permissions: DEFAULT_PERMISSIONS.manager };
    assert.equal(canAccessPositions(user), true);
  });

  it("canAccessPositions — користувач без прав", () => {
    assert.equal(canAccessPositions({ role: "operator", permissions: {} }), false);
    assert.equal(canAccessPositions(null), false);
  });

  it("isQueryTokenAllowed — лише безпечні GET шляхи", () => {
    assert.equal(isQueryTokenAllowed("GET", "/api/notifications/stream"), true);
    assert.equal(isQueryTokenAllowed("GET", "/api/positions/42/constructive-file"), true);
    assert.equal(isQueryTokenAllowed("GET", "/api/positions/42/constructive-file/7"), true);
    assert.equal(isQueryTokenAllowed("GET", "/api/positions"), false);
    assert.equal(isQueryTokenAllowed("POST", "/api/notifications/stream"), false);
    assert.equal(isQueryTokenAllowed("GET", "/api/orders"), false);
  });
});

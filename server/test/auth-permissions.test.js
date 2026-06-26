import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAccessPositions,
  canViewBusinessData,
  isQueryTokenAllowed
} from "../src/middleware/auth.js";
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

  it("canViewBusinessData — чистий оператор без доступу до списків", () => {
    const user = {
      role: "operator",
      permissions: { ...DEFAULT_PERMISSIONS.operator, canUseOperatorPanel: true }
    };
    assert.equal(canViewBusinessData(user), false);
  });

  it("canViewBusinessData — менеджер має доступ", () => {
    const user = { role: "manager", permissions: DEFAULT_PERMISSIONS.manager };
    assert.equal(canViewBusinessData(user), true);
  });

  it("isQueryTokenAllowed — лише безпечні GET шляхи", () => {
    assert.equal(isQueryTokenAllowed("GET", "/api/notifications/stream"), true);
    assert.equal(isQueryTokenAllowed("GET", "/api/positions/42/constructive-file"), true);
    assert.equal(isQueryTokenAllowed("GET", "/api/positions/42/constructive-file/7"), true);
    assert.equal(isQueryTokenAllowed("GET", "/api/positions/42/part-labels"), true);
    assert.equal(
      isQueryTokenAllowed("GET", "/api/positions/42/constructive-packages/9/files/3"),
      true
    );
    assert.equal(isQueryTokenAllowed("GET", "/api/constructive/packages/9/files/3"), true);
    assert.equal(isQueryTokenAllowed("GET", "/api/orders/5/3d/12/report"), true);
    assert.equal(isQueryTokenAllowed("GET", "/api/positions"), false);
    assert.equal(isQueryTokenAllowed("POST", "/api/notifications/stream"), false);
    assert.equal(isQueryTokenAllowed("GET", "/api/orders"), false);
  });
});

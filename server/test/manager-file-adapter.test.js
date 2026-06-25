import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatWorkspaceFileId,
  parseManagerFileId,
  workspaceKindToManagerKind
} from "../../shared/production/manager-file-adapter.js";

describe("manager file adapter", () => {
  it("мапить workspace kind у manager_*", () => {
    assert.equal(workspaceKindToManagerKind("tech"), "manager_appliance");
    assert.equal(workspaceKindToManagerKind("measurements"), "manager_measurement");
    assert.equal(workspaceKindToManagerKind("manager_image"), "manager_photo");
  });

  it("parseManagerFileId розпізнає ws- префікс", () => {
    const ws = parseManagerFileId("ws-42");
    assert.equal(ws.source, "workspace");
    assert.equal(ws.id, 42);
    const pf = parseManagerFileId("17");
    assert.equal(pf.source, "position_files");
    assert.equal(pf.id, 17);
  });

  it("formatWorkspaceFileId додає префікс", () => {
    assert.equal(formatWorkspaceFileId(5), "ws-5");
  });
});

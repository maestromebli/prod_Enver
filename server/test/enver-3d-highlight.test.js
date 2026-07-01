import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHighlightResult } from "../../client/src/3d/enver-3d-selection.js";

describe("buildHighlightResult", () => {
  it("повертає ok з mesh_found для знайденої деталі", () => {
    const result = buildHighlightResult({
      ok: true,
      mesh: { name: "panel-14" },
      part: { id: 123, modelMeshName: "panel-14", modelNodeId: "14" }
    });
    assert.equal(result.ok, true);
    assert.equal(result.meshName, "panel-14");
    assert.equal(result.partId, 123);
    assert.equal(result.mappingStatus, "exact");
    assert.equal(result.reason, "mesh_found");
  });

  it("повертає missing, якщо mesh не знайдено", () => {
    const result = buildHighlightResult({
      ok: false,
      meshName: "panel-99",
      part: { id: 5, partNo: "99" },
      reason: "mesh_not_found"
    });
    assert.equal(result.ok, false);
    assert.equal(result.meshName, "panel-99");
    assert.equal(result.mappingStatus, "fallback");
    assert.equal(result.reason, "mesh_not_found");
  });

  it("підтримує ambiguous", () => {
    const result = buildHighlightResult({
      ok: false,
      part: { id: 7 },
      mappingStatus: "ambiguous",
      reason: "ambiguous_mesh"
    });
    assert.equal(result.mappingStatus, "ambiguous");
    assert.equal(result.reason, "ambiguous_mesh");
  });
});

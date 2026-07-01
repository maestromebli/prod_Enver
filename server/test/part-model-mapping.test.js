import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolvePartMappingStatus,
  summarizeMappingDiagnostics
} from "../../shared/production/part-model-mapping.js";
import { normalizeBazisScanCode } from "../../shared/production/bazis-operation-code.js";
import { autoMapManifestNodes } from "../src/constructive/constructive-package-service.js";

describe("normalizeBazisScanCode (operator scan)", () => {
  it("нормалізує код з префіксом NC1 і суфіксом V", () => {
    assert.equal(normalizeBazisScanCode("NC1: 0010x002x1V"), "0010X002X1");
  });

  it("виправляє кириличну x від HID-сканера", () => {
    assert.equal(normalizeBazisScanCode("0014ч006ч1"), "0014X006X1");
  });
});

describe("resolvePartMappingStatus", () => {
  it("exact — modelMeshName з manifest", () => {
    const s = resolvePartMappingStatus({
      partNo: "10",
      modelMeshName: "panel-0010X002X1",
      modelNodeId: "0010X002X1"
    });
    assert.equal(s.mappingStatus, "exact");
    assert.equal(s.mappingConfidence, 100);
    assert.equal(s.resolvedMeshName, "panel-0010X002X1");
  });

  it("fallback — partCode без збереженого mesh", () => {
    const s = resolvePartMappingStatus({ partNo: "10", partCode: "0010X002X1" });
    assert.equal(s.mappingStatus, "fallback");
    assert.ok(s.mappingConfidence >= 60);
    assert.equal(s.resolvedMeshName, "panel-0010X002X1");
  });

  it("fallback — blockCode-partNo", () => {
    const s = resolvePartMappingStatus({ blockCode: "B1", partNo: "21" });
    assert.equal(s.mappingStatus, "fallback");
    assert.equal(s.resolvedMeshName, "B1-21");
  });

  it("fallback — partNo → panel-partNo", () => {
    const s = resolvePartMappingStatus({ partNo: "10" });
    assert.equal(s.mappingStatus, "fallback");
    assert.ok(s.mappingConfidence >= 40 && s.mappingConfidence <= 60);
  });

  it("missing — без ключів", () => {
    const s = resolvePartMappingStatus({ partName: "Полиця" });
    assert.equal(s.mappingStatus, "missing");
    assert.equal(s.mappingConfidence, 0);
  });
});

describe("summarizeMappingDiagnostics", () => {
  it("рахує статус готовності", () => {
    const parts = [
      { partNo: "1", modelMeshName: "A", modelNodeId: "A", partName: "A", material: "ДСП" },
      { partNo: "2", partCode: "P2", partName: "B", material: "ДСП" },
      { partName: "C", material: "ДСП" }
    ];
    const summary = summarizeMappingDiagnostics(parts, [
      { meshName: "A" },
      { meshName: "panel-P2" }
    ]);
    assert.equal(summary.totalParts, 3);
    assert.equal(summary.exactCount, 1);
    assert.equal(summary.fallbackCount, 1);
    assert.equal(summary.missingCount, 1);
    assert.ok(summary.unmappedParts.length >= 2);
  });

  it("враховує ambiguousParts", () => {
    const parts = [
      { id: 1, partNo: "21", partName: "Бік 1", material: "ДСП" },
      { id: 2, partNo: "21", partName: "Бік 2", material: "ДСП" }
    ];
    const summary = summarizeMappingDiagnostics(
      parts,
      [{ meshName: "B1-21" }],
      [
        { partId: 1, meshName: "B1-21" },
        { partId: 2, meshName: "B1-21" }
      ]
    );
    assert.equal(summary.ambiguousCount, 2);
    assert.ok(summary.unmappedParts.every((p) => p.mappingStatus === "ambiguous"));
  });
});

describe("autoMapManifestNodes (extended)", () => {
  it("повертає mappings і summary", () => {
    const parts = [{ id: 1, blockCode: "B1", partNo: "21", partName: "Бік" }];
    const nodes = [{ meshName: "B1-21", nodeId: "B1-21", partNo: "21", blockCode: "B1" }];
    const result = autoMapManifestNodes(parts, nodes);
    assert.equal(result.mappings.length, 1);
    assert.equal(result.mappings[0].modelMeshName, "B1-21");
    assert.ok(result.summary.autoMappedCount >= 1);
  });

  it("позначає ambiguous, якщо один mesh для двох деталей", () => {
    const parts = [
      { id: 1, blockCode: "B1", partNo: "21", partName: "Бік 1" },
      { id: 2, blockCode: "B1", partNo: "21", partName: "Бік 2" }
    ];
    const nodes = [{ meshName: "B1-21", nodeId: "B1-21", partNo: "21", blockCode: "B1" }];
    const result = autoMapManifestNodes(parts, nodes);
    assert.equal(result.mappings.length, 0);
    assert.equal(result.summary.ambiguousCount, 2);
  });

  it("зіставляє за partCode", () => {
    const parts = [{ id: 3, partNo: "10", partCode: "0010X002X1", partName: "Полиця" }];
    const nodes = [{ meshName: "panel-0010X002X1", nodeId: "0010X002X1" }];
    const result = autoMapManifestNodes(parts, nodes);
    assert.equal(result.mappings[0].modelMeshName, "panel-0010X002X1");
  });
});

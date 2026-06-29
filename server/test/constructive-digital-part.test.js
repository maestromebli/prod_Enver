import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBarcodeValue,
  buildPartCode,
  buildInstanceBarcode,
  computeChecksum
} from "../src/constructive/part-code.js";
import { buildConstructiveReviewSummary } from "../../shared/production/constructive-review.js";
import { packageGodmodeContextFromRow } from "../src/constructive-package-enrich.js";
import { getPositionNextAction } from "../../shared/production/godmode.js";
import { mergeParseResults } from "../src/constructive/parsers/index.js";
import { autoMapManifestNodes } from "../src/constructive/constructive-package-service.js";
import {
  getConstructivePackageNextAction,
  getConstructivePackageWarnings
} from "../../shared/production/constructive-godmode.js";
import {
  canReleasePackageToCnc,
  isPackageApprovedForCnc,
  detectPackageFileKind,
  CONSTRUCTIVE_PIPELINE_STEPS,
  isPackageParsedStatus,
  isPackageNotParsedStatus,
  packageParseDisplay,
  constructivePipelineStepIndex
} from "../../shared/production/constructive-package.js";
import { renderPartLabelsHtml } from "../src/constructive/labels.js";

describe("constructive/part-code", () => {
  it("генерує унікальний barcode ENVER-{order}-{position}-{package}-{partNo}", () => {
    const code = buildBarcodeValue({
      orderNumber: "E-30",
      positionId: 102,
      packageId: 55,
      partNo: "21"
    });
    assert.match(code, /^ENVER-E-30-102-55-21$/);
  });

  it("додає block_code при неунікальному part_no", () => {
    const code = buildBarcodeValue({
      orderNumber: "E30",
      positionId: 1,
      packageId: 2,
      partNo: "21",
      blockCode: "B1"
    });
    assert.match(code, /B1-21$/);
  });

  it("buildPartCode формує код деталі", () => {
    assert.equal(buildPartCode({ orderNumber: "E30", blockCode: "B1", partNo: "21" }), "E30-B1-21");
  });

  it("computeChecksum стабільний", () => {
    const a = computeChecksum(Buffer.from("test"));
    const b = computeChecksum(Buffer.from("test"));
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });

  it("buildInstanceBarcode для qty>1", () => {
    assert.equal(buildInstanceBarcode("ENVER-E30-1-1-21", 2), "ENVER-E30-1-1-21-I2");
  });
});

describe("constructive/parsers merge", () => {
  it("обʼєднує матеріали з кількох файлів", () => {
    const merged = mergeParseResults([
      {
        materials: [{ materialName: "ДСП 18" }],
        hardware: [],
        parts: [],
        extractionQuality: "partial"
      },
      {
        materials: [{ materialName: "МДФ" }],
        hardware: [{ name: "петля" }],
        parts: [{ partNo: "1", partName: "Бік" }],
        extractionQuality: "good"
      }
    ]);
    assert.equal(merged.materials.length, 2);
    assert.equal(merged.hardware.length, 1);
    assert.equal(merged.parts.length, 1);
    assert.equal(merged.extractionQuality, "partial");
  });
});

describe("constructive-package shared", () => {
  it("detectPackageFileKind для xls/project/b3d/cnc", () => {
    assert.equal(detectPackageFileKind("spec.xls"), "spec_xls");
    assert.equal(detectPackageFileKind("model.b3d"), "b3d");
    assert.equal(detectPackageFileKind("kitchen.glb"), "glb_model");
    assert.equal(detectPackageFileKind("assembly.wrl"), "wrl_model");
    assert.equal(detectPackageFileKind("B1-21.nc"), "cnc_file");
  });

  it("has3dPreviewFile і preview3dLayout для .wrl", async () => {
    const { has3dPreviewFile, preview3dLayout, findPackagePreview3dFile, preview3dLoadFormat } =
      await import("../../shared/production/constructive-package.js");
    const detail = {
      files: [{ kind: "wrl_model", originalName: "111.wrl" }]
    };
    assert.equal(has3dPreviewFile(detail), true);
    assert.equal(preview3dLayout(detail), "assembly");
    assert.equal(findPackagePreview3dFile(detail)?.originalName, "111.wrl");
    assert.equal(preview3dLoadFormat(detail.files[0]), "wrl");
  });

  it("partitionPackageFilesByRole та shouldShowModelMappingTab", async () => {
    const {
      partitionPackageFilesByRole,
      canCreateModelMapping,
      canAutoParsePackageForMapping,
      shouldShowModelMappingTab
    } = await import("../../shared/production/constructive-package.js");
    const files = [
      { kind: "project", originalName: "kitchen.project" },
      { kind: "b3d", originalName: "kitchen.b3d" }
    ];
    const parts = partitionPackageFilesByRole(files);
    assert.equal(parts.project.length, 1);
    assert.equal(parts.b3d.length, 1);
    assert.equal(canCreateModelMapping({ files }), true);
    assert.equal(canAutoParsePackageForMapping({ files, package: { status: "uploaded" } }), true);
    assert.equal(canAutoParsePackageForMapping({ files, package: { status: "parsed" } }), false);
    assert.equal(shouldShowModelMappingTab({ files, parts: [{ id: 1, partNo: "21" }] }), true);
    assert.equal(shouldShowModelMappingTab({ files, parts: [] }), true);
    assert.equal(shouldShowModelMappingTab({ files: [files[0]], parts: [{ id: 1 }] }), false);
    assert.equal(shouldShowModelMappingTab({ files: [files[0]], parts: [] }), false);
    assert.equal(
      canCreateModelMapping({
        files: [
          { kind: "spec_xls", originalName: "a.xls" },
          { kind: "cnc_file", originalName: "B1-21.nc" }
        ]
      }),
      false
    );
  });

  it("formatPartDimensionsMm — розміри в мм", async () => {
    const { formatPartDimensionsMm, formatMmNumber, stripMmUnit } =
      await import("../../shared/production/constructive-package.js");
    assert.equal(stripMmUnit("16 мм"), "16");
    assert.equal(formatMmNumber("1896.00"), "1896");
    assert.equal(formatPartDimensionsMm({ length: "580", width: "720" }), "580×720 мм");
    assert.equal(
      formatPartDimensionsMm({ length: "500", width: "400", thickness: "16" }),
      "500×400×16 мм"
    );
    assert.equal(
      formatPartDimensionsMm({ length: "1896.00", width: "540.00", thickness: "18" }),
      "1896×540×18 мм"
    );
    assert.equal(formatPartDimensionsMm({ length: "", width: "" }), "—");
    assert.equal(formatPartDimensionsMm({ length: "500", width: "" }), "—");
  });

  it("formatMeshBoundingBoxMm — метри GLB і мм VRML", async () => {
    const { formatMeshBoundingBoxMm, scaleLocalMeshExtents, detectSceneExtentsPreferMm } =
      await import("../../shared/production/constructive-package.js");
    assert.equal(formatMeshBoundingBoxMm([1.896, 0.018, 0.54]), "1896×540×18 мм");
    assert.equal(formatMeshBoundingBoxMm([1896, 540, 18]), "1896×540×18 мм");
    assert.equal(formatMeshBoundingBoxMm([1, 1, 1], { preferMm: false }), "1000×1000×1000 мм");
    assert.equal(
      formatMeshBoundingBoxMm([1.896, 0.018, 0.54], { preferMm: false }),
      "1896×540×18 мм"
    );
    assert.equal(formatMeshBoundingBoxMm([1896, 540, 18], { preferMm: true }), "1896×540×18 мм");
    assert.deepEqual(scaleLocalMeshExtents([1, 1, 1], [1.896, 0.018, 0.54]), [1.896, 0.018, 0.54]);
    assert.equal(detectSceneExtentsPreferMm([2.4, 1.8, 0.6]), false);
    assert.equal(detectSceneExtentsPreferMm([2400, 1800, 600]), true);
    assert.equal(formatMeshBoundingBoxMm([]), "");
  });

  it("normalizePartNoKey — panel-010 → деталь №10", async () => {
    const { normalizePartNoKey, meshNameLookupKeys, resolvePartByMeshName } =
      await import("../../shared/production/constructive-package.js");
    assert.equal(normalizePartNoKey("010"), "10");
    const keys = meshNameLookupKeys("panel-010");
    assert.ok(keys.has("10"));
    const parts = [{ partNo: "10", partName: "Стійка", length: "500", width: "400" }];
    assert.equal(resolvePartByMeshName("panel-010", parts)?.partName, "Стійка");
  });

  it("resolvePartByMeshName — зіставлення mesh з деталлю", async () => {
    const { resolvePartByMeshName, formatPartPickerInfo } =
      await import("../../shared/production/constructive-package.js");
    const parts = [
      {
        blockCode: "B1",
        partNo: "21",
        partName: "Бік лівий",
        material: "ДСП 18",
        length: "500",
        width: "720",
        thickness: "18",
        modelMeshName: "B1-21"
      },
      { partNo: "10", partName: "Стійка", length: "1896", width: "540" }
    ];
    assert.equal(resolvePartByMeshName("B1-21", parts)?.partName, "Бік лівий");
    assert.equal(resolvePartByMeshName("panel-10", parts)?.partName, "Стійка");
    assert.equal(resolvePartByMeshName("10", parts)?.partName, "Стійка");
    const info = formatPartPickerInfo(parts[0]);
    assert.equal(info.numberLine, "B1 · №21");
    assert.equal(info.dimensions, "500×720×18 мм");
    assert.equal(info.material, "ДСП 18");
    const fallback = formatPartPickerInfo(
      { blockCode: "B2", partNo: "3", partName: "Полиця" },
      { sizeLabel: "800×400×18 мм" }
    );
    assert.equal(fallback.dimensions, "800×400×18 мм");
    const meshOnly = formatPartPickerInfo(null, { sizeLabel: "600×320×16 мм" });
    assert.equal(meshOnly.dimensions, "600×320×16 мм");
  });

  it("isStalePackageParsing — завислий parsing", async () => {
    const { isStalePackageParsing, PACKAGE_PARSING_STALE_MS } =
      await import("../../shared/production/constructive-package.js");
    const recent = {
      status: "parsing",
      updatedAt: new Date(Date.now() - PACKAGE_PARSING_STALE_MS + 5000).toISOString()
    };
    const old = {
      status: "parsing",
      updatedAt: new Date(Date.now() - PACKAGE_PARSING_STALE_MS - 1000).toISOString()
    };
    assert.equal(isStalePackageParsing(recent), false);
    assert.equal(isStalePackageParsing(old), true);
    assert.equal(isStalePackageParsing({ status: "parsed", updatedAt: old.updatedAt }), false);
  });

  it("canReleasePackageToCnc лише після перевірки", () => {
    assert.equal(canReleasePackageToCnc("uploaded"), false);
    assert.equal(canReleasePackageToCnc("parsed"), false);
    assert.equal(canReleasePackageToCnc("approved_by_production"), true);
  });

  it("isPackageApprovedForCnc", () => {
    assert.equal(isPackageApprovedForCnc("parsed"), false);
    assert.equal(isPackageApprovedForCnc("approved_by_constructor"), true);
    assert.equal(isPackageApprovedForCnc("procurement_done"), true);
  });

  it("pipeline без закупівлі — окремий паралельний процес", () => {
    assert.ok(!CONSTRUCTIVE_PIPELINE_STEPS.some((s) => s.key === "procurement"));
    const reviewIdx = CONSTRUCTIVE_PIPELINE_STEPS.findIndex((s) => s.key === "review");
    const approvedIdx = CONSTRUCTIVE_PIPELINE_STEPS.findIndex((s) => s.key === "approved");
    const productionIdx = CONSTRUCTIVE_PIPELINE_STEPS.findIndex((s) => s.key === "production");
    assert.ok(reviewIdx >= 0 && approvedIdx > reviewIdx && productionIdx > approvedIdx);
    assert.ok(!CONSTRUCTIVE_PIPELINE_STEPS.some((s) => s.key === "cnc_dispatch"));
  });
});

describe("cnc-parser", async () => {
  const { parseCncBuffer } = await import("../src/constructive/parsers/cnc-parser.js");

  it("витягує partNo з імені файлу", () => {
    const r = parseCncBuffer(Buffer.from(""), "B1-21.nc");
    assert.ok(r.manifestNodes.some((n) => n.partNo === "21"));
  });

  it("витягує деталі з коментарів G-code", () => {
    const gcode = Buffer.from("(PART B2-15)\nG0 X0\n; DETAIL 3\n");
    const r = parseCncBuffer(gcode, "run.nc");
    assert.ok(r.manifestNodes.some((n) => n.partNo === "15" || n.meshName.includes("15")));
  });
});

describe("constructive-package shared continued", () => {
  it("packageParseDisplay — не розібрано / розбір / розібрано", () => {
    assert.equal(isPackageNotParsedStatus("uploaded"), true);
    assert.equal(isPackageParsedStatus("uploaded"), false);
    assert.equal(packageParseDisplay("uploaded").title, "Не розібрано");
    assert.equal(packageParseDisplay("parsing").parsing, true);
    assert.equal(packageParseDisplay("parsed", 42).parsed, true);
    assert.equal(packageParseDisplay("parsed", 42).subtitle, "42 деталей у специфікації");
    assert.equal(constructivePipelineStepIndex("parsed"), 1);
    assert.equal(constructivePipelineStepIndex("uploaded"), 0);
    assert.equal(constructivePipelineStepIndex("needs_review"), 2);
    assert.equal(constructivePipelineStepIndex("approved_by_constructor"), 3);
    assert.equal(constructivePipelineStepIndex("sent_to_procurement"), 4);
  });

  it("nextAction для uploaded — розібрати", () => {
    const action = getConstructivePackageNextAction({ packageStatus: "uploaded" });
    assert.equal(action.type, "parse_constructive_package");
  });

  it("nextAction для parsed — перевірка перед закупівлею", () => {
    const action = getConstructivePackageNextAction({ packageStatus: "parsed" });
    assert.equal(action.type, "review_constructive");
  });

  it("nextAction для approved — передача в чергу порізки через godmode позиції", () => {
    const action = getConstructivePackageNextAction({ packageStatus: "approved_by_constructor" });
    assert.equal(action, null);
  });

  it("nextAction для procurement_done — pipeline завершено", () => {
    const action = getConstructivePackageNextAction({ packageStatus: "procurement_done" });
    assert.equal(action, null);
  });

  it("warning для unmapped parts", () => {
    const w = getConstructivePackageWarnings({ unmappedPartsCount: 3 });
    assert.ok(w.some((x) => x.type === "unmapped_3d_parts"));
  });

  it("canHandoffPackageToCutting для підтвердженого пакета", async () => {
    const { canHandoffPackageToCutting, PACKAGE_HANDOFF_TO_CUTTING_STATUSES } =
      await import("../../shared/production/constructive-package.js");
    assert.ok(PACKAGE_HANDOFF_TO_CUTTING_STATUSES.includes("approved_by_production"));
    assert.equal(canHandoffPackageToCutting({ packageStatus: "approved_by_production" }), true);
    assert.equal(canHandoffPackageToCutting({ packageStatus: "parsed" }), false);
  });

  it("validateHandoffToCutting для підтвердженого пакета без legacy-прапорця", async () => {
    const { validateHandoffToCutting } =
      await import("../../shared/production/constructive-package.js");
    const row = {
      has_constructive_file: false,
      has_constructive_package: true,
      constructive_parts_count: 401,
      constructive_package_status: "approved_by_production",
      cutting_status: "Не розпочато"
    };
    const check = validateHandoffToCutting(row, {
      packageStatus: "approved_by_production",
      hasConstructivePackage: true,
      constructivePartsCount: 401
    });
    assert.equal(check.ok, true);
  });

  it("validateHandoffToCutting блокує непідтверджений пакет", async () => {
    const { validateHandoffToCutting } =
      await import("../../shared/production/constructive-package.js");
    const check = validateHandoffToCutting(
      {
        has_constructive_package: true,
        constructive_parts_count: 10,
        constructive_package_status: "parsed",
        cutting_status: "Не розпочато"
      },
      { packageStatus: "parsed", hasConstructivePackage: true }
    );
    assert.equal(check.ok, false);
  });
});

describe("labels", () => {
  it("рендерить HTML з barcode даними", async () => {
    const html = await renderPartLabelsHtml({
      position: { order_number: "E-30", item: "Кухня" },
      parts: [
        {
          blockCode: "B1",
          partNo: "21",
          partName: "Бік лівий",
          material: "ДСП",
          length: "580",
          width: "720",
          thickness: "18",
          edgeCode: "",
          barcodeValue: "ENVER-E-30-1-1-21",
          qrValue: "ENVER-E-30-1-1-21"
        }
      ]
    });
    assert.match(html, /ENVER-E-30-1-1-21/);
    assert.match(html, /Бік лівий/);
    assert.match(html, /<svg/);
  });
});

describe("scan unknown barcode message", () => {
  it("human-readable помилка для порожнього коду", () => {
    const msg = "Деталь не знайдено. Перевірте етикетку або введіть код вручну.";
    assert.ok(msg.includes("не знайдено"));
  });
});

describe("approval before cnc release", () => {
  it("uploaded status не дозволяє передачу на верстат", () => {
    assert.equal(isPackageApprovedForCnc("uploaded"), false);
    assert.equal(canReleasePackageToCnc("uploaded"), false);
  });
});

describe("packageGodmodeContextFromRow", () => {
  it("передає packageStatus у godmode context", () => {
    const ctx = packageGodmodeContextFromRow({
      constructive_package_status: "parsed",
      has_constructive_package: true,
      unmapped_parts_count: 2
    });
    assert.equal(ctx.packageStatus, "parsed");
    assert.equal(ctx.hasConstructivePackage, true);
    assert.equal(ctx.unmappedPartsCount, 2);
  });

  it("getPositionNextAction з packageStatus — parse", () => {
    const action = getPositionNextAction(
      {
        item: "Кухня",
        delivery_address: "Адреса",
        position_deadline: "01.07.2026",
        has_constructive_file: true,
        cutting_status: "Не розпочато",
        current_stage: "constructor",
        constructor_name: "Ігор"
      },
      { packageStatus: "uploaded", hasConstructivePackage: true, managerDataComplete: true }
    );
    assert.equal(action.type, "parse_constructive_package");
  });

  it("getPositionNextAction після підтвердження — передати на порізку", () => {
    const action = getPositionNextAction(
      {
        item: "Кухня",
        has_constructive_file: true,
        cutting_status: "Не розпочато",
        edging_status: "Не розпочато",
        drilling_status: "Не розпочато",
        assembly_status: "Не розпочато",
        current_stage: "constructor",
        constructor_name: "Ігор"
      },
      {
        packageStatus: "approved_by_constructor",
        hasConstructivePackage: true,
        managerDataComplete: true
      }
    );
    assert.equal(action.type, "handoff_to_cutting");
  });

  it("getPositionNextAction без packageStatus — не пропонує ШІ замість порізки", async () => {
    const row = {
      item: "Кухня",
      delivery_address: "вул. Тестова 1",
      position_deadline: "01.07.2026",
      has_constructive_file: true,
      cutting_status: "Не розпочато",
      edging_status: "Не розпочато",
      drilling_status: "Не розпочато",
      assembly_status: "Не розпочато",
      current_stage: "constructor",
      constructor_name: "Ігор",
      constructive_package_status: "approved_by_constructor",
      has_constructive_package: true,
      manager_files_count: 1
    };
    const { godmodeContextFromRow } = await import("../src/godmode-enrich.js");
    const ctx = godmodeContextFromRow(row, { planDate: "01.07.2026" });
    const action = getPositionNextAction(row, ctx);
    assert.equal(action.type, "handoff_to_cutting");
  });
});

describe("autoMapManifestNodes", () => {
  it("зіставляє деталь за partNo у meshName", () => {
    const parts = [{ id: 1, blockCode: "B1", partNo: "21", partName: "Бік" }];
    const nodes = [{ meshName: "B1-21", partNo: "21" }];
    const mapped = autoMapManifestNodes(parts, nodes);
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0].partId, 1);
  });

  it("зіставляє B1-21 з blockCode + partNo", () => {
    const parts = [{ id: 2, blockCode: "B1", partNo: "21", partName: "Бік" }];
    const nodes = [{ meshName: "B1-21", nodeId: "B1-21", partNo: "21", blockCode: "B1" }];
    const mapped = autoMapManifestNodes(parts, nodes);
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0].modelMeshName, "B1-21");
  });

  it("mergeParseResults збирає manifestNodes з блоків PDF", () => {
    const merged = mergeParseResults([
      {
        blocks: [{ code: "B1" }],
        parts: [{ blockCode: "B1", partNo: "3", partName: "Полиця" }],
        extractionQuality: "partial"
      }
    ]);
    assert.ok(merged.manifestNodes.some((n) => n.meshName === "B1"));
    assert.ok(merged.manifestNodes.some((n) => n.partNo === "3"));
  });
});

describe("buildConstructiveReviewSummary", () => {
  it("виявляє відсутність PDF і XLS", () => {
    const summary = buildConstructiveReviewSummary({
      package: { status: "parsed" },
      files: [],
      parts: [{ blockCode: "B1", partNo: "1", partName: "Бік", material: "ДСП" }],
      materials: [],
      hardware: []
    });
    assert.equal(summary.checks.find((c) => c.key === "pdf")?.ok, false);
    assert.equal(summary.checks.find((c) => c.key === "xls")?.ok, false);
    assert.ok(summary.warnings.some((w) => w.includes("PDF")));
  });

  it("readyForReview коли є parts і файли", () => {
    const summary = buildConstructiveReviewSummary({
      package: { status: "parsed" },
      files: [
        { kind: "assembly_pdf", originalName: "a.pdf" },
        { kind: "spec_xls", originalName: "b.xls" }
      ],
      parts: [{ blockCode: "B1", partNo: "1", partName: "Бік", material: "ДСП" }],
      materials: [{ materialName: "ДСП" }],
      hardware: []
    });
    assert.equal(summary.readyForReview, true);
    assert.equal(summary.counts.parts, 1);
  });

  it("3D мапінг без GLB — з ЧПК, не вимагає GLB", () => {
    const summary = buildConstructiveReviewSummary({
      package: { status: "parsed" },
      files: [
        { kind: "spec_xls", originalName: "a.xls" },
        { kind: "b3d", originalName: "m.b3d" },
        { kind: "cnc_file", originalName: "B1-21.nc" }
      ],
      parts: [
        {
          blockCode: "B1",
          partNo: "21",
          partName: "Бік",
          modelMeshName: "B1-21",
          modelNodeId: "B1-21"
        }
      ],
      materials: [],
      hardware: []
    });
    const mappingCheck = summary.checks.find((c) => c.key === "3d");
    assert.equal(mappingCheck?.ok, true);
    assert.ok(!mappingCheck?.detail?.includes("GLB"));
    assert.ok(!summary.warnings.some((w) => w.includes("GLB")));
    const previewCheck = summary.checks.find((c) => c.key === "glb_preview");
    assert.equal(previewCheck?.ok, true);
    assert.ok(previewCheck?.detail?.includes("очікується"));
  });

  it("3D превʼю ok коли є GLB з .b3d", () => {
    const summary = buildConstructiveReviewSummary({
      package: { status: "uploaded" },
      files: [
        { kind: "b3d", originalName: "m.b3d" },
        { kind: "glb_model", originalName: "3d-preview.glb" }
      ],
      parts: [],
      materials: [],
      hardware: []
    });
    const previewCheck = summary.checks.find((c) => c.key === "glb_preview");
    assert.equal(previewCheck?.ok, true);
    assert.ok(previewCheck?.detail?.includes("GibLab"));
  });

  it("3D превʼю ok коли є VRML збірка", () => {
    const summary = buildConstructiveReviewSummary({
      package: { status: "uploaded" },
      files: [{ kind: "wrl_model", originalName: "111.wrl" }],
      parts: [],
      materials: [],
      hardware: []
    });
    const previewCheck = summary.checks.find((c) => c.key === "glb_preview");
    assert.equal(previewCheck?.ok, true);
    assert.ok(previewCheck?.detail?.includes("VRML"));
  });
});

describe("project/b3d parsers for 3D mapping", async () => {
  const { parseProjectBuffer } = await import("../src/constructive/parsers/project-parser.js");
  const { parseB3dBuffer } = await import("../src/constructive/parsers/b3d-parser.js");

  it("project XML витягує деталі за code та manifestNodes", () => {
    const xml = `<?xml version="1.0"?><Project><part code="21" name="Бік лівий" dl="500" dw="300" Block="B1"/></Project>`;
    const r = parseProjectBuffer(Buffer.from(xml, "utf8"), "test.project");
    assert.equal(r.parts.length, 1);
    assert.equal(r.parts[0].partNo, "21");
    assert.equal(r.parts[0].length, "500");
    assert.ok(r.manifestNodes.some((n) => n.partNo === "21"));
  });

  it("b3d витягує B1-21 з тексту", () => {
    const buf = Buffer.from("Furniture\x00B1-21\x00Name: Side panel", "utf8");
    const r = parseB3dBuffer(buf, "test.b3d");
    assert.ok(r.manifestNodes.some((n) => n.meshName.includes("B1-21") || n.partNo === "21"));
  });

  it("wrl витягує DEF-вузли для manifest", async () => {
    const { parseWrlBuffer } = await import("../src/constructive/parsers/wrl-parser.js");
    const text = `#VRML V2.0 utf8
DEF Cabinet Group { children [ DEF Panel1 Shape {} ] }
DEF TLine3D_1 LineSet {}
`;
    const r = parseWrlBuffer(Buffer.from(text, "utf8"), "test.wrl");
    assert.equal(r.modelReadiness.has3dSource, true);
    assert.ok(r.manifestNodes.some((n) => n.meshName === "Cabinet"));
    assert.ok(r.manifestNodes.some((n) => n.meshName === "Panel1"));
    assert.ok(!r.manifestNodes.some((n) => n.meshName === "TLine3D_1"));
  });
});

describe("procurement from constructor XLS", () => {
  it("canCreateProcurement — з XLS після розбору, без ЧПК", async () => {
    const { canCreateProcurement, hasConstructorProcurementSource } =
      await import("../../shared/production/constructive-package.js");
    const detail = {
      package: { status: "parsed" },
      files: [{ kind: "spec_xls", originalName: "spec.xls" }],
      materials: [{ materialName: "ДСП 18", qtyEstimated: "3" }],
      hardware: [{ name: "Петля" }]
    };
    assert.equal(hasConstructorProcurementSource(detail), true);
    assert.equal(canCreateProcurement(detail), true);
    assert.equal(canCreateProcurement({ ...detail, procurement: { id: 1 } }), false);
    assert.equal(
      canCreateProcurement({
        ...detail,
        files: [{ kind: "cnc_file", originalName: "B1-1.nc" }],
        materials: []
      }),
      false
    );
  });

  it("canAutoParsePackage — XLS без ЧПК", async () => {
    const {
      canAutoParsePackage,
      canAutoParsePackageForMapping,
      shouldDeferParseForMappingPair,
      shouldComplementMappingPackage
    } = await import("../../shared/production/constructive-package.js");
    const detail = {
      package: { status: "uploaded" },
      files: [{ kind: "spec_xls", originalName: "a.xls" }]
    };
    assert.equal(canAutoParsePackage(detail), true);
    assert.equal(canAutoParsePackageForMapping(detail), false);

    const onlyProject = {
      package: { status: "uploaded" },
      files: [{ kind: "project", originalName: "a.project" }]
    };
    assert.equal(shouldDeferParseForMappingPair(onlyProject), true);
    assert.equal(canAutoParsePackage(onlyProject), false);

    const pair = {
      package: { status: "uploaded" },
      files: [
        { kind: "project", originalName: "a.project" },
        { kind: "b3d", originalName: "a.b3d" }
      ]
    };
    assert.equal(canAutoParsePackage(pair), true);
    assert.equal(shouldDeferParseForMappingPair(pair), false);

    const complement = {
      package: { id: 1, status: "approved_by_constructor" },
      files: [{ kind: "b3d", originalName: "m.b3d" }]
    };
    assert.equal(shouldComplementMappingPackage(complement, ["project"]), true);
  });

  it("findSplitMappingPackages та pickComplementMappingPackage", async () => {
    const { findSplitMappingPackages, pickComplementMappingPackage } =
      await import("../../shared/production/constructive-package.js");

    const split = findSplitMappingPackages([
      {
        package: { id: 10, version: 2 },
        files: [{ id: 1, kind: "b3d", originalName: "m.b3d" }]
      },
      {
        package: { id: 9, version: 1 },
        files: [{ id: 2, kind: "project", originalName: "m.project" }]
      }
    ]);
    assert.equal(split?.targetPackageId, 10);
    assert.equal(split?.missingKind, "project");
    assert.equal(split?.fileId, 2);

    const complement = pickComplementMappingPackage(
      [
        {
          package: { id: 5, version: 3 },
          files: [{ kind: "b3d" }]
        },
        {
          package: { id: 4, version: 2 },
          files: [{ kind: "project" }]
        }
      ],
      ["project"]
    );
    assert.equal(complement?.id, 5);
  });
});

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
  canSendToGitlab,
  isPackageApprovedForCnc,
  detectPackageFileKind
} from "../../shared/production/constructive-package.js";
import { DEFAULT_PERMISSIONS } from "../../shared/production/permissions.js";
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
  it("detectPackageFileKind для xls/project/b3d", () => {
    assert.equal(detectPackageFileKind("spec.xls"), "spec_xls");
    assert.equal(detectPackageFileKind("model.b3d"), "b3d");
    assert.equal(detectPackageFileKind("kitchen.glb"), "glb_model");
  });

  it("canSendToGitlab лише після approval", () => {
    assert.equal(canSendToGitlab("uploaded"), false);
    assert.equal(canSendToGitlab("approved_by_production"), true);
  });

  it("isPackageApprovedForCnc", () => {
    assert.equal(isPackageApprovedForCnc("parsed"), false);
    assert.equal(isPackageApprovedForCnc("approved_by_constructor"), true);
  });
});

describe("constructive-godmode", () => {
  it("nextAction для uploaded — розібрати", () => {
    const action = getConstructivePackageNextAction({ packageStatus: "uploaded" });
    assert.equal(action.type, "parse_constructive_package");
  });

  it("warning для unmapped parts", () => {
    const w = getConstructivePackageWarnings({ unmappedPartsCount: 3 });
    assert.ok(w.some((x) => x.type === "unmapped_3d_parts"));
  });
});

describe("permissions finance", () => {
  it("оператор не бачить фінанси", () => {
    assert.equal(DEFAULT_PERMISSIONS.operator.canViewFinance, false);
  });

  it("production бачить фінанси", () => {
    assert.equal(DEFAULT_PERMISSIONS.production.canViewFinance, true);
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

describe("approval before gitlab", () => {
  it("uploaded status не дозволяє GitLab", () => {
    assert.equal(isPackageApprovedForCnc("uploaded"), false);
    assert.equal(canSendToGitlab("uploaded"), false);
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
});

describe("autoMapManifestNodes", () => {
  it("зіставляє деталь за partNo у meshName", () => {
    const parts = [{ id: 1, blockCode: "B1", partNo: "21", partName: "Бік" }];
    const nodes = [{ meshName: "B1-21", partNo: "21" }];
    const mapped = autoMapManifestNodes(parts, nodes);
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0].partId, 1);
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
});

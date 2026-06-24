import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBarcodeValue,
  buildPartCode,
  buildInstanceBarcode,
  computeChecksum
} from "../src/constructive/part-code.js";
import { packageGodmodeContextFromRow } from "../src/constructive-package-enrich.js";
import { getPositionNextAction } from "../../shared/production/godmode.js";
import { mergeParseResults } from "../src/constructive/parsers/index.js";
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
      { has_constructive_file: true, cutting_status: "Не розпочато" },
      { packageStatus: "uploaded", hasConstructivePackage: true }
    );
    assert.equal(action.type, "parse_constructive_package");
  });
});

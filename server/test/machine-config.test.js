import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAiSourceSubfolders } from "../src/machine-config.js";
import { buildPositionFolderContext } from "../src/machine-ai-matcher.js";

describe("machine-config", () => {
  it("parseAiSourceSubfolders повертає дефолт для порожнього значення", () => {
    assert.deepEqual(parseAiSourceSubfolders(""), ["meta.json", "giblab", "kdt"]);
    assert.deepEqual(parseAiSourceSubfolders("[]"), ["meta.json", "giblab", "kdt"]);
  });

  it("parseAiSourceSubfolders чистить масив", () => {
    assert.deepEqual(parseAiSourceSubfolders('["kdt", "  giblab  ", ""]'), ["kdt", "giblab"]);
  });
});

describe("buildPositionFolderContext", () => {
  it("витягує meta та файли з обраних підпапок", () => {
    const row = {
      folder_meta_json: JSON.stringify({
        orderNumber: "EN-01",
        object: "Кухня",
        items: [{ name: "Стільниця", kdtFolder: "kdt/top" }]
      }),
      folder_files_json: JSON.stringify([
        { path: "giblab/project.txt", name: "project.txt" },
        { path: "kdt/Kitchen/job.xml", name: "job.xml" },
        { path: "photos/plan.jpg", name: "plan.jpg" }
      ])
    };

    const ctx = buildPositionFolderContext(row, ["meta.json", "giblab", "kdt"]);
    assert.match(ctx, /кухня/i);
    assert.match(ctx, /стільниця/i);
    assert.match(ctx, /giblab\/project\.txt/);
    assert.match(ctx, /kdt\/Kitchen\/job\.xml/);
    assert.doesNotMatch(ctx, /photos/);
  });
});

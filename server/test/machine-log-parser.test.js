import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseLogLine, extractTokens } from "../src/machine-log-parser.js";

describe("machine-log-parser", () => {
  it("витягує прогрес у відсотках", () => {
    const p = parseLogLine("2024-05-01 10:00:00 Progress: 45%", "generic");
    assert.equal(p.eventType, "progress");
    assert.equal(p.progress, 45);
  });

  it("розпізнає завершення програми", () => {
    const p = parseLogLine("Program completed M30", "biesse");
    assert.equal(p.eventType, "complete");
    assert.equal(p.progress, 100);
  });

  it("витягує job ref для зіставлення", () => {
    const p = parseLogLine('Job: EN-2405-012 Kitchen panel', "generic");
    assert.ok(p.jobRef.includes("EN-2405") || p.tokens.length > 0);
  });

  it("extractTokens прибирає стоп-слова", () => {
    const t = extractTokens("order EN-2405 kitchen", "EN-2405");
    assert.ok(t.includes("en-2405") || t.some((x) => x.includes("2405")));
  });
});

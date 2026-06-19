import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  determineKdtStatus,
  extractJobFromXmlPath,
  kdtEventToEnverParsed,
  parseKdtAllLogsFromFiles,
  parseKdtTimestamp
} from "../src/kdt-log-parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleDir = path.join(__dirname, "..", "samples");

describe("kdt-log-parser", () => {
  it("парсить timestamp KDT", () => {
    const ts = parseKdtTimestamp("2025-05-19 08:12:01.123 some text");
    assert.ok(ts?.raw.startsWith("2025-05-19"));
  });

  it("витягує замовлення з шляху xml", () => {
    const job = extractJobFromXmlPath("C:\\KDTSaw1\\EN-2405-01\\Kitchen\\panel.xml");
    assert.equal(job.orderName, "EN-2405-01");
    assert.equal(job.materialName, "Kitchen");
  });

  it("визначає статус cutting з demo логу", () => {
    const logPath = path.join(sampleDir, "cutting-demo.log");
    if (!fs.existsSync(logPath)) return;
    const content = fs.readFileSync(logPath, "utf8");
    const events = [];
    for (const line of content.split(/\r?\n/)) {
      const ts = parseKdtTimestamp(line);
      if (!ts) continue;
      events.push({
        time: ts.raw,
        date: ts.date,
        raw: line,
        eventType: line.includes("开始加工")
          ? "cutting_started"
          : line.includes("加工完成")
            ? "cutting_completed"
            : "unknown",
        job: extractJobFromXmlPath(line.match(/\.xml/i) ? line : null),
        counters: null
      });
    }
    const status = determineKdtStatus(events);
    assert.ok(status.progress >= 0);
  });

  it("parseKdtAllLogsFromFiles об'єднує кілька файлів і сортує за датою", () => {
    const events = parseKdtAllLogsFromFiles([
      {
        name: "sub/a.txt",
        text: "2025-05-19 08:12:02.000 later line"
      },
      {
        name: "b.txt",
        text: "2025-05-19 08:12:01.000 earlier line"
      }
    ]);
    assert.equal(events.length, 2);
    assert.equal(events[0].sourcePath, "b.txt");
    assert.equal(events[1].sourcePath, "sub/a.txt");
  });

  it("kdtEventToEnverParsed формує jobRef", () => {
    const parsed = kdtEventToEnverParsed(
      {
        time: "2025-05-19 08:12:05.000",
        eventType: "cutting_started",
        job: { orderName: "EN-99", materialName: "Kitchen", xmlFileName: "a.xml" },
        counters: { doneCurrent: 1, doneTotal: 4 },
        raw: "x"
      },
      { progress: 25, statusText: "test" }
    );
    assert.ok(parsed.jobRef.includes("EN-99"));
    assert.equal(parsed.progress, 25);
  });
});

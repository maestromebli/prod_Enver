#!/usr/bin/env node
/**
 * Перевірка мінімального line coverage після server test:coverage.
 * COVERAGE_MIN_LINES (default 48) — поріг у відсотках.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const min = Number(process.env.COVERAGE_MIN_LINES || 44);
const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server");

const result = spawnSync("npm", ["run", "test:coverage"], {
  cwd: serverDir,
  encoding: "utf8",
  shell: true
});

const output = `${result.stdout || ""}${result.stderr || ""}`;
process.stdout.write(output);

const match = output.match(/all files\s+\|\s+([\d.]+)/);
if (!match) {
  console.error("\n[coverage] не знайдено рядок all files у звіті");
  process.exit(1);
}

const pct = Number(match[1]);
if (!Number.isFinite(pct) || pct < min) {
  console.error(`\n[coverage] ${pct}% < мінімум ${min}%`);
  process.exit(1);
}

console.log(`\n[coverage] OK: ${pct}% (мін. ${min}%)`);
process.exit(result.status === 0 ? 0 : result.status || 1);

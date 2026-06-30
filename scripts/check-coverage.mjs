#!/usr/bin/env node
/**
 * Перевірка line coverage.
 * COVERAGE_SCOPE=shared (default) — shared/production, мін. COVERAGE_MIN_LINES (default 95).
 * COVERAGE_SCOPE=all — server + shared, мін. COVERAGE_MIN_LINES_ALL (default 48).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scope = process.env.COVERAGE_SCOPE || "shared";
const minShared = Number(process.env.COVERAGE_MIN_LINES || 95);
const minAll = Number(process.env.COVERAGE_MIN_LINES_ALL || 48);
const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server");

const script = scope === "all" ? "test:coverage" : "test:coverage:shared";
const min = scope === "all" ? minAll : minShared;

const result = spawnSync("npm", ["run", script], {
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
const label = scope === "all" ? "усього (server+shared)" : "shared/production";

if (!Number.isFinite(pct) || pct < min) {
  console.error(`\n[coverage] ${label}: ${pct}% < мінімум ${min}%`);
  process.exit(1);
}

console.log(`\n[coverage] OK ${label}: ${pct}% (мін. ${min}%)`);
process.exit(result.status === 0 ? 0 : result.status || 1);

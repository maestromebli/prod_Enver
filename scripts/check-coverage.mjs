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
const min = scope === "all" ? minAll : minShared;
const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server");

// e2e job: інтеграційні тести з Postgres — без coverage-звіту (поріг shared уже в validate).
if (scope === "all" && process.env.RUN_INTEGRATION_TESTS === "1") {
  const result = spawnSync("npm", ["test"], {
    cwd: serverDir,
    encoding: "utf8",
    shell: false,
    stdio: "inherit"
  });
  process.exit(result.status ?? 1);
}

const script = scope === "all" ? "run-coverage-all.mjs" : "run-coverage-shared.mjs";

const result = spawnSync("node", [`scripts/${script}`], {
  cwd: serverDir,
  encoding: "utf8",
  shell: false,
  maxBuffer: 128 * 1024 * 1024
});

const output = `${result.stdout || ""}${result.stderr || ""}`;
process.stdout.write(output);

const matches = [...output.matchAll(/all files\s+\|\s+([\d.]+)/g)];
const match = matches.at(-1);
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
process.exit(0);

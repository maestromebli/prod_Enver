#!/usr/bin/env node
/**
 * Композитна оцінка якості коду (ціль ≥ 95).
 * lint 20% + format 10% + typecheck 10% + tests 20% + shared line coverage 40%
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const minScore = Number(process.env.QUALITY_MIN_SCORE || 95);
const sharedCoverageMin = Number(process.env.SHARED_COVERAGE_MIN_LINES || 95);

function run(cmd, args, { cwd = root, env = {} } = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    shell: true,
    env: { ...process.env, ...env }
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    out: `${result.stdout || ""}${result.stderr || ""}`
  };
}

function lintScore() {
  const result = run("npm", ["run", "lint", "--", "--max-warnings", "0"]);
  if (result.ok) return { score: 100, detail: "0 warnings" };
  const warnings = (result.out.match(/\d+ warning/gi) || []).pop() || "warnings";
  process.stdout.write(result.out);
  return { score: 0, detail: warnings };
}

function passScore(label, npmScript) {
  const result = run("npm", ["run", npmScript]);
  if (!result.ok) process.stdout.write(result.out);
  return { score: result.ok ? 100 : 0, detail: result.ok ? "ok" : "fail" };
}

function sharedCoverageScore() {
  const serverDir = path.join(root, "server");
  const result = spawnSync("node", ["scripts/run-coverage-shared.mjs"], {
    cwd: serverDir,
    encoding: "utf8",
    shell: false,
    maxBuffer: 32 * 1024 * 1024
  });
  const out = `${result.stdout || ""}${result.stderr || ""}`;
  const matches = [...out.matchAll(/all files\s+\|\s+([\d.]+)/g)];
  const match = matches.at(-1);
  if (!match) {
    process.stdout.write(out);
    return { score: 0, detail: "no coverage report", pct: 0, testsOk: false };
  }
  const pct = Number(match[1]);
  const score = Math.min(100, (pct / sharedCoverageMin) * 100);
  return {
    score,
    detail: `${pct}% line (мін. ${sharedCoverageMin}%)`,
    pct,
    testsOk: result.status === 0
  };
}

const weights = { lint: 0.2, format: 0.1, typecheck: 0.1, tests: 0.2, coverage: 0.4 };

const lint = lintScore();
const format = passScore("format", "format:check");
const typecheck = passScore("typecheck", "typecheck");
const tests = passScore("tests", "test");
const coverage = sharedCoverageScore();

if (!coverage.testsOk) {
  console.error("\n[quality] тести під час coverage не пройшли");
  process.exit(coverage.testsOk === false ? 1 : 0);
}

const total =
  lint.score * weights.lint +
  format.score * weights.format +
  typecheck.score * weights.typecheck +
  tests.score * weights.tests +
  coverage.score * weights.coverage;

console.log("\n[quality] оцінка якості коду:");
console.log(`  lint:      ${lint.score.toFixed(0)} (${lint.detail})`);
console.log(`  format:    ${format.score.toFixed(0)} (${format.detail})`);
console.log(`  typecheck: ${typecheck.score.toFixed(0)} (${typecheck.detail})`);
console.log(`  tests:     ${tests.score.toFixed(0)} (${tests.detail})`);
console.log(`  shared:    ${coverage.score.toFixed(0)} (${coverage.detail})`);
console.log(`  ─────────────────────────`);
console.log(`  РАЗОМ:     ${total.toFixed(1)} / 100 (мін. ${minScore})`);

if (total + 1e-6 < minScore) {
  console.error(`\n[quality] ${total.toFixed(1)} < ${minScore}`);
  process.exit(1);
}

console.log(`\n[quality] OK: ${total.toFixed(1)}`);
process.exit(0);

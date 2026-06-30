#!/usr/bin/env node
/**
 * Shared/production coverage без shell-glob (стабільно на Linux CI).
 */
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const include = path.join(serverDir, "../shared/production/**/*.js").replace(/\\/g, "/");

const tests = [
  ...globSync("test/*.test.js", { cwd: serverDir }),
  ...globSync("test/integration/*.test.mjs", { cwd: serverDir })
];

const args = [
  "--test",
  "--test-concurrency=1",
  "--experimental-test-coverage",
  `--test-coverage-include=${include}`,
  ...tests
];

const result = spawnSync(process.execPath, args, {
  cwd: serverDir,
  encoding: "utf8",
  stdio: "inherit",
  shell: false
});

process.exit(result.status ?? 1);

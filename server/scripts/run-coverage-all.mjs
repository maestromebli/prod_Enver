#!/usr/bin/env node
/**
 * Повне coverage server + shared без shell-glob.
 */
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcInclude = path.join(serverDir, "src/**/*.js").replace(/\\/g, "/");
const sharedInclude = path.join(serverDir, "../shared/production/**/*.js").replace(/\\/g, "/");

const tests = [
  ...globSync("test/*.test.js", { cwd: serverDir }),
  ...globSync("test/integration/*.test.mjs", { cwd: serverDir })
];

const args = [
  "--test",
  "--test-concurrency=1",
  "--experimental-test-coverage",
  `--test-coverage-include=${srcInclude}`,
  `--test-coverage-include=${sharedInclude}`,
  ...tests
];

const result = spawnSync(process.execPath, args, {
  cwd: serverDir,
  encoding: "utf8",
  stdio: "inherit",
  shell: false
});

process.exit(result.status ?? 1);

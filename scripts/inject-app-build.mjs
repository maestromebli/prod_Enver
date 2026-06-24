#!/usr/bin/env node
/**
 * Підставляє APP_BUILD_SHA у service worker перед збіркою клієнта.
 * Викликається в Docker CI; локально — опційно перед npm run build.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const buildRaw = String(process.env.APP_BUILD_SHA || "dev").trim();
const build = buildRaw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "dev";

const swPath = path.join(root, "client", "public", "sw-operator.js");
let content = fs.readFileSync(swPath, "utf8");
content = content.replace(
  /const CACHE = "enver-operator-[^"]+"/,
  `const CACHE = "enver-operator-${build}"`
);
fs.writeFileSync(swPath, content);
console.log(`inject-app-build: CACHE=enver-operator-${build}`);

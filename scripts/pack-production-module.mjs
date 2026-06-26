#!/usr/bin/env node
/**
 * Збирає архів enver-production-module.zip для переносу та підключення
 * виробничого модуля (цех, оператор, ШІ-аналіз конструктивів) до ENVER OS.
 *
 *   node scripts/pack-production-module.mjs
 *   npm run pack:production-module
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outZip = path.join(root, "releases", "enver-production-module.zip");
const staging = path.join(root, "releases", "_production-module-staging");

/** Відносні шляхи від кореня репозиторію */
const MODULE_FILES = [
  // ——— Сервер: API та логіка цеху ———
  "server/src/routes/production.js",
  "server/src/routes/operator.js",
  "server/src/routes/ai.js",
  "server/src/constructive-ai.js",
  "server/src/file-storage.js",
  "server/src/order-status-workflow.js",
  "server/src/order-status-sync.js",
  "shared/production/position-logic.js",
  "shared/production/stages.js",
  "shared/production/permissions.js",
  "server/src/kpi-snapshots.js",
  "server/src/roles.js",
  // ——— Клієнт: цех і оператор ———
  "client/src/production-floor.js",
  "client/src/operator-panel.js",
  "client/src/operator-app.js",
  "client/src/operator-kiosk.js",
  "client/src/workflows.js",
  "client/src/terminology.js",
  "client/src/users-constants.js",
  "client/src/styles/production-floor.css",
  "client/src/styles/operator.css",
  "client/src/styles/operator-client.css",
  "client/operator.html",
  "client/android-install.html",
  "client/src/android-install.js",
  "client/public/manifest-operator.webmanifest",
  "client/public/sw-operator.js",
  "client/public/icons/icon-192.png",
  "client/public/icons/icon-512.png",
  // ——— Тести модуля ———
  "server/test/order-status-workflow.test.js",
  "server/test/shared-production.test.js"
];

const MODULE_DIRS = [];

const DOC_FILES = [
  "releases/production-module/PIDKLUCHENNYA.md",
  "releases/production-module/templates/env.production-module.example"
];

function readPkgVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return pkg.version || "1.0.0";
  } catch {
    return "1.0.0";
  }
}

function readGitSha() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function copyFile(srcRel, destRel) {
  const src = path.join(root, srcRel);
  if (!fs.existsSync(src)) {
    console.warn("⚠ пропущено (немає файлу):", srcRel);
    return false;
  }
  const dest = path.join(staging, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function copyDir(srcRel, destRel, { skip = [] } = {}) {
  const src = path.join(root, srcRel);
  if (!fs.existsSync(src)) {
    console.warn("⚠ пропущено (немає папки):", srcRel);
    return;
  }
  const skipSet = new Set(skip);
  const walk = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      if (skipSet.has(name)) continue;
      const sf = path.join(from, name);
      const df = path.join(to, name);
      const st = fs.statSync(sf);
      if (st.isDirectory()) walk(sf, df);
      else fs.copyFileSync(sf, df);
    }
  };
  walk(src, path.join(staging, destRel));
}

function extractSchemaExcerpt() {
  const migration = path.join(root, "server/migrations/0001_init.sql");
  if (!fs.existsSync(migration)) return "";
  const sql = fs.readFileSync(migration, "utf8");
  const tableNames = ["operator_sessions", "position_files", "constructive_analyses"];
  const tablePattern = new RegExp(`CREATE TABLE IF NOT EXISTS (${tableNames.join("|")})`);
  const lines = sql.split("\n");
  const out = ["-- Фрагмент схеми виробничого модуля (з 0001_init.sql)", ""];
  let capture = false;
  let depth = 0;
  for (const line of lines) {
    if (tablePattern.test(line)) {
      capture = true;
      depth = 0;
    }
    if (!capture) continue;
    out.push(line);
    if (line.includes("(")) depth += (line.match(/\(/g) || []).length;
    if (line.includes(")")) depth -= (line.match(/\)/g) || []).length;
    if (capture && line.trim().endsWith(";") && depth <= 0) {
      out.push("");
      capture = false;
    }
  }
  return out.join("\n");
}

function buildManifest(copiedFiles) {
  const version = readPkgVersion();
  const sha = readGitSha();
  return {
    name: "enver-production-module",
    title: "Виробничий модуль ENVER",
    version,
    builtAt: new Date().toISOString(),
    gitSha: sha,
    target: "ENVER OS",
    description: "Цех, панель оператора (5 етапів), ШІ-аналіз конструктивів, клієнт Android (PWA)",
    api: {
      production: ["/api/production/floor"],
      operator: [
        "/api/operator/queue/:stageKey",
        "/api/operator/start",
        "/api/operator/pause",
        "/api/operator/resume",
        "/api/operator/finish"
      ],
      ai: [
        "/api/ai/analyze-constructive/:positionId",
        "/api/ai/analyses/:positionId",
        "/api/ai/feedback"
      ],
      positions: ["/api/positions/:id/constructive-file", "/api/positions/:id/create-tasks"]
    },
    permissions: ["canUseOperatorPanel", "canViewProductionFloor"],
    operatorStages: ["cutting", "edging", "drilling", "assembly"],
    files: copiedFiles.sort(),
    docs: {
      connection: "PIDKLUCHENNYA.md",
      envExample: "templates/env.production-module.example",
      androidInstall: "/android-install.html"
    }
  };
}

function main() {
  console.log("Збірка архіву виробничого модуля…");

  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  const copied = [];

  for (const rel of MODULE_FILES) {
    const dest = path.join("module", rel);
    if (copyFile(rel, dest)) copied.push(dest);
  }

  for (const rel of MODULE_DIRS) {
    const dest = path.join("operator-clients", path.basename(rel));
    copyDir(rel, dest, { skip: ["node_modules", "dist", ".git"] });
    copied.push(`${dest}/`);
  }

  for (const rel of DOC_FILES) {
    const base = path.basename(rel);
    const dest = rel.includes("templates/") ? path.join("templates", base) : base;
    if (copyFile(rel, dest)) copied.push(dest);
  }

  const schema = extractSchemaExcerpt();
  if (schema) {
    const schemaPath = path.join(staging, "database", "schema-production.sql");
    fs.mkdirSync(path.dirname(schemaPath), { recursive: true });
    fs.writeFileSync(schemaPath, schema, "utf8");
    copied.push("database/schema-production.sql");
  }

  const manifest = buildManifest(copied);
  fs.writeFileSync(
    path.join(staging, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  fs.writeFileSync(
    path.join(staging, "README.txt"),
    `ENVER — виробничий модуль v${manifest.version}
Git: ${manifest.gitSha}
Збірка: ${manifest.builtAt}

1. Прочитайте PIDKLUCHENNYA.md
2. Підключіть до ENVER OS (сервер + права + клієнти оператора)
3. Відкрийте на планшетах Android сторінку установки з ENVER OS (Налаштування → Клієнти)

Архів: releases/enver-production-module.zip
`,
    "utf8"
  );

  fs.mkdirSync(path.dirname(outZip), { recursive: true });
  if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

  execSync(`cd "${staging}" && zip -r "${outZip}" . -x "*.DS_Store"`, {
    stdio: "inherit"
  });

  fs.rmSync(staging, { recursive: true, force: true });

  const stat = fs.statSync(outZip);
  const mb = (stat.size / (1024 * 1024)).toFixed(2);
  console.log(`\n✓ Архів: ${outZip} (${mb} MB)`);
  console.log(`  Файлів у модулі: ${copied.length}`);
}

main();

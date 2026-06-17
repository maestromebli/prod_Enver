import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseGiblabText, hashGiblabContent } from "../../server/src/giblab-parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEXT_EXT = new Set([".txt", ".xml", ".gib", ".csv", ".json", ".dxf", ".pdf"]);

export function loadConfig() {
  const configPath = path.join(__dirname, "..", "config.json");
  const example = path.join(__dirname, "..", "config.example.json");
  const file = fs.existsSync(configPath) ? configPath : example;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readMeta(folderPath) {
  const metaPath = path.join(folderPath, "meta.json");
  if (!fs.existsSync(metaPath)) {
    return { orderNumber: path.basename(folderPath) };
  }
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return { orderNumber: path.basename(folderPath) };
  }
}

function listFilesRecursive(dir, base = dir, limit = 200) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  function walk(current, depth = 0) {
    if (files.length >= limit || depth > 6) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (!TEXT_EXT.has(ext) && ext !== "") continue;
        const rel = path.relative(base, full).replace(/\\/g, "/");
        const stat = fs.statSync(full);
        files.push({
          name: entry.name,
          path: rel,
          type: ext.replace(".", "") || "file",
          size: stat.size
        });
      }
    }
  }

  walk(dir);
  return files;
}

function readGiblabSummary(folderPath, meta) {
  const candidates = [];
  if (meta.giblabFile) candidates.push(path.join(folderPath, meta.giblabFile));
  const gibDir = path.join(folderPath, "giblab");
  if (fs.existsSync(gibDir)) {
    for (const f of fs.readdirSync(gibDir)) {
      candidates.push(path.join(gibDir, f));
    }
  }

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const summary = parseGiblabText(content, path.basename(filePath));
      summary.hash = hashGiblabContent(content);
      return summary;
    } catch {
      /* binary gib — skip */
    }
  }
  return {};
}

export function scanStateFolder(rootPath, state) {
  const stateDir = path.join(rootPath, state);
  if (!fs.existsSync(stateDir)) return [];

  const folders = [];
  for (const entry of fs.readdirSync(stateDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const folderPath = path.join(stateDir, entry.name);
    const meta = readMeta(folderPath);
    const folderKey = meta.orderNumber || entry.name;
    const files = listFilesRecursive(folderPath);
    const giblabSummary = readGiblabSummary(folderPath, meta);

    folders.push({
      folderKey,
      folderPath: `${state}/${entry.name}`,
      state,
      meta,
      files,
      giblabSummary
    });
  }
  return folders;
}

export function scanAll(rootPath, states = ["inbox", "active", "done"]) {
  return states.flatMap((state) => scanStateFolder(rootPath, state));
}

export function moveFolder(rootPath, folderKey, fromState, toState) {
  const fromDir = path.join(rootPath, fromState);
  const toDir = path.join(rootPath, toState);
  if (!fs.existsSync(toDir)) fs.mkdirSync(toDir, { recursive: true });

  const entries = fs.readdirSync(fromDir, { withFileTypes: true });
  let sourceName = null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = readMeta(path.join(fromDir, entry.name));
    const key = meta.orderNumber || entry.name;
    if (key === folderKey || entry.name === folderKey) {
      sourceName = entry.name;
      break;
    }
  }
  if (!sourceName) {
    throw new Error(`Папку ${folderKey} не знайдено в ${fromState}`);
  }

  const fromPath = path.join(fromDir, sourceName);
  const toPath = path.join(toDir, sourceName);
  if (fs.existsSync(toPath)) {
    throw new Error(`Ціль вже існує: ${toPath}`);
  }
  fs.renameSync(fromPath, toPath);
  return toPath;
}

export function archiveFolder(rootPath, folderKey, fromState) {
  const year = String(new Date().getFullYear());
  const archiveRoot = path.join(rootPath, "archive", year);
  if (!fs.existsSync(archiveRoot)) fs.mkdirSync(archiveRoot, { recursive: true });

  const fromDir = path.join(rootPath, fromState);
  const entries = fs.readdirSync(fromDir, { withFileTypes: true });
  let sourceName = null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = readMeta(path.join(fromDir, entry.name));
    const key = meta.orderNumber || entry.name;
    if (key === folderKey || entry.name === folderKey) {
      sourceName = entry.name;
      break;
    }
  }
  if (!sourceName) {
    throw new Error(`Папку ${folderKey} не знайдено для архівації`);
  }

  const fromPath = path.join(fromDir, sourceName);
  const toPath = path.join(archiveRoot, sourceName);
  if (fs.existsSync(toPath)) {
    throw new Error(`Архів вже існує: ${toPath}`);
  }
  fs.renameSync(fromPath, toPath);
  return toPath;
}

export function ensureRootLayout(rootPath) {
  for (const dir of ["inbox", "active", "done", "archive", "giblab"]) {
    const p = path.join(rootPath, dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
}

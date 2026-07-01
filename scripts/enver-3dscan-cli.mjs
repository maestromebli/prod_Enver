#!/usr/bin/env node
/**
 * ENVER_3dscan CLI — аналіз пар .b3d + .project, звіти, побудова sidecar JSON.
 *
 *   node scripts/enver-3dscan-cli.mjs scan <шлях-до-папки>
 *   node scripts/enver-3dscan-cli.mjs scan /Users/enver/Downloads/2026.rar
 *   node scripts/enver-3dscan-cli.mjs fuse <file.b3d> [--project file.project] [--out report.json]
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fuseBazisPackage } from "../server/src/constructive/enver-3dscan-fusion.js";
import { buildEnver3dscanFromB3dDecode } from "../server/src/constructive/bazis-b3d-decoder.js";
import {
  appendEnver3dscanToB3d,
  extractEnver3dscanFromB3d,
  isBazisB3dBuffer
} from "../shared/production/enver-3dscan.js";

const B3D_RE = /\.b3d$/i;
const PROJECT_RE = /\.project$/i;

function readFile(p) {
  return fs.readFileSync(p);
}

function walkDir(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkDir(full, out);
    else out.push(full);
  }
  return out;
}

function extractRarToTemp(rarPath) {
  const tmp = fs.mkdtempSync(path.join(process.cwd(), ".enver-3dscan-"));
  execSync(`bsdtar -xf ${JSON.stringify(rarPath)} -C ${JSON.stringify(tmp)}`, {
    stdio: "inherit"
  });
  return tmp;
}

function resolveScanRoot(inputPath) {
  const abs = path.resolve(inputPath);
  if (!fs.existsSync(abs)) throw new Error(`Шлях не існує: ${abs}`);
  if (abs.toLowerCase().endsWith(".rar")) {
    return { root: extractRarToTemp(abs), temp: true };
  }
  return { root: abs, temp: false };
}

function pairB3dProject(files) {
  const b3dFiles = files.filter((f) => B3D_RE.test(f));
  const projectFiles = files.filter((f) => PROJECT_RE.test(f));
  const pairs = [];

  for (const b3d of b3dFiles) {
    const base = path.basename(b3d, path.extname(b3d)).toLowerCase();
    const dir = path.dirname(b3d);
    let project =
      projectFiles.find(
        (p) => path.dirname(p) === dir && p.toLowerCase().includes(base.slice(0, 8))
      ) ||
      projectFiles.find((p) => path.dirname(p) === dir) ||
      null;
    if (!project && projectFiles.length) {
      const sameDir = projectFiles.filter((p) => path.dirname(p) === dir);
      project = sameDir[0] || null;
    }
    pairs.push({ b3d, project });
  }

  for (const project of projectFiles) {
    if (!pairs.some((p) => p.project === project)) {
      pairs.push({ b3d: null, project });
    }
  }

  return pairs;
}

function analyzePair({ b3d, project }) {
  const b3dBuffer = b3d ? readFile(b3d) : null;
  const projectBuffer = project ? readFile(project) : null;
  const fused = fuseBazisPackage({
    b3dBuffer,
    projectBuffer,
    productName: b3d ? path.basename(b3d) : path.basename(project || "")
  });

  return {
    b3d: b3d ? path.relative(process.cwd(), b3d) : null,
    project: project ? path.relative(process.cwd(), project) : null,
    b3dBytes: b3dBuffer?.length || 0,
    isBz85: b3dBuffer ? isBazisB3dBuffer(b3dBuffer) : false,
    hasEnver3dscanTail: b3dBuffer ? Boolean(extractEnver3dscanFromB3d(b3dBuffer)) : false,
    stats: fused.stats,
    warnings: fused.warnings,
    partCount: fused.parts.length,
    scanPanelCount: fused.scan?.panels?.length || 0,
    assemblyReady: Boolean(fused.assemblyExport),
    layout: fused.assemblyExport ? "assembly" : fused.parts.length ? "flat" : "none"
  };
}

function cmdScan(inputPath, { outReport = null } = {}) {
  const { root, temp } = resolveScanRoot(inputPath);
  const files = walkDir(root);
  const pairs = pairB3dProject(files);
  const results = pairs.map(analyzePair);
  const summary = {
    scannedAt: new Date().toISOString(),
    root: inputPath,
    pairCount: pairs.length,
    withB3d: results.filter((r) => r.b3d).length,
    withProject: results.filter((r) => r.project).length,
    withBoth: results.filter((r) => r.b3d && r.project).length,
    assemblyReady: results.filter((r) => r.assemblyReady).length,
    hasEnver3dscan: results.filter((r) => r.hasEnver3dscanTail).length,
    results
  };

  const out = outReport || path.join(process.cwd(), "enver-3dscan-report.json");
  fs.writeFileSync(out, JSON.stringify(summary, null, 2), "utf8");
  console.log(`ENVER_3dscan: ${pairs.length} пар, звіт → ${out}`);
  if (temp) {
    console.log(`(тимчасова розпаковка: ${root})`);
  }
  return summary;
}

function cmdDecode(b3dPath, { outJson = null } = {}) {
  const b3dBuffer = readFile(b3dPath);
  const { scan, analysis } = buildEnver3dscanFromB3dDecode(b3dBuffer, {
    productName: path.basename(b3dPath)
  });
  const payload = {
    decodedAt: new Date().toISOString(),
    b3d: b3dPath,
    analysis,
    scan
  };
  const out = outJson || b3dPath.replace(/\.b3d$/i, "") + ".b3d-decode.json";
  fs.writeFileSync(out, JSON.stringify(payload, null, 2), "utf8");
  console.log(
    `BZ85 decode: ${analysis.stats?.decodedPanelCount || 0} панелей (${analysis.stats?.posedPanelCount || 0} з координатами) → ${out}`
  );
  return payload;
}

function cmdFuse(b3dPath, { projectPath = null, outJson = null, patchB3d = false } = {}) {
  const b3dBuffer = readFile(b3dPath);
  const projectBuffer = projectPath ? readFile(projectPath) : null;
  const fused = fuseBazisPackage({ b3dBuffer, projectBuffer });

  const payload = {
    fusedAt: new Date().toISOString(),
    b3d: b3dPath,
    project: projectPath,
    stats: fused.stats,
    warnings: fused.warnings,
    scan: fused.scan,
    parts: fused.parts,
    manifestNodes: fused.manifestNodes
  };

  const out = outJson || b3dPath.replace(/\.b3d$/i, "") + ".enver-3dscan.json";
  fs.writeFileSync(out, JSON.stringify(fused.scan || payload, null, 2), "utf8");
  console.log(`ENVER_3dscan JSON → ${out}`);

  if (patchB3d && fused.scan) {
    const patched = appendEnver3dscanToB3d(b3dBuffer, fused.scan);
    const patchedPath = b3dPath.replace(/\.b3d$/i, "") + ".enver-3dscan.b3d";
    fs.writeFileSync(patchedPath, patched);
    console.log(`Патчений .b3d → ${patchedPath}`);
  }

  return payload;
}

const [, , command, target, ...rest] = process.argv;

if (!command || command === "--help" || command === "-h") {
  console.log(`Використання:
  node scripts/enver-3dscan-cli.mjs scan <папка|архів.rar> [--out report.json]
  node scripts/enver-3dscan-cli.mjs decode <file.b3d> [--out decode.json]
  node scripts/enver-3dscan-cli.mjs fuse <file.b3d> [--project file.project] [--out out.json] [--patch-b3d]`);
  process.exit(0);
}

const outIdx = rest.indexOf("--out");
const outReport = outIdx >= 0 ? rest[outIdx + 1] : null;
const projectIdx = rest.indexOf("--project");
const projectPath = projectIdx >= 0 ? rest[projectIdx + 1] : null;
const patchB3d = rest.includes("--patch-b3d");

if (command === "scan") {
  if (!target) {
    console.error("Вкажіть шлях до папки або .rar");
    process.exit(1);
  }
  cmdScan(target, { outReport });
} else if (command === "decode") {
  if (!target) {
    console.error("Вкажіть шлях до .b3d");
    process.exit(1);
  }
  cmdDecode(target, { outJson: outReport });
} else if (command === "fuse") {
  if (!target) {
    console.error("Вкажіть шлях до .b3d");
    process.exit(1);
  }
  cmdFuse(target, { projectPath, outJson: outReport, patchB3d });
} else {
  console.error("Невідома команда:", command);
  process.exit(1);
}

import { all, one } from "../../db.js";
import { readStoredFile } from "../../file-storage.js";

function normalizeName(name = "") {
  return String(name)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function nameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const ta = new Set(na.split(/\s+/).filter((w) => w.length > 2));
  const tb = new Set(nb.split(/\s+/).filter((w) => w.length > 2));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter += 1;
  return inter / Math.max(ta.size, tb.size);
}

function scorePackage(files, { b3dFileName } = {}) {
  let score = 0;
  let hasProject = false;
  let hasB3d = false;
  let hasAssembly = false;
  let hasGlb = false;
  let hasWrl = false;
  let b3dName = null;

  for (const file of files) {
    if (file.kind === "project") {
      hasProject = true;
      score += 20;
    }
    if (file.kind === "b3d") {
      hasB3d = true;
      score += 8;
      b3dName = file.original_name;
      score += nameSimilarity(b3dFileName, file.original_name) * 12;
    }
    if (file.kind === "glb_model") {
      hasGlb = true;
      score += 10;
      if (String(file.original_name || "").toLowerCase() === "3d-preview.glb") score += 5;
    }
    if (file.kind === "wrl_model") {
      hasWrl = true;
      score += 14;
    }
    if (file.kind === "other") {
      const lower = String(file.original_name || "").toLowerCase();
      if (lower === "enver-assembly.json" || lower.endsWith(".enver-assembly.json")) {
        hasAssembly = true;
        score += 18;
      }
    }
  }

  if (hasProject && hasB3d) score += 15;
  if (hasProject && hasAssembly) score += 10;

  return { score, hasProject, hasB3d, hasAssembly, hasGlb, hasWrl, b3dName };
}

async function loadPackageFiles(packageId) {
  return all(
    `SELECT kind, original_name, storage_path
     FROM constructive_package_files
     WHERE package_id = $1
     ORDER BY id DESC`,
    [packageId]
  );
}

async function collectPackagesForOrder(orderId) {
  const seen = new Set();
  const packages = [];

  const push = (row) => {
    if (!row?.id || seen.has(row.id)) return;
    seen.add(row.id);
    packages.push(row);
  };

  for (const row of await all(
    `SELECT cp.id, cp.position_id, cp.updated_at
     FROM constructive_packages cp
     WHERE cp.order_id = $1
     ORDER BY cp.updated_at DESC NULLS LAST, cp.id DESC
     LIMIT 12`,
    [orderId]
  )) {
    push(row);
  }

  for (const row of await all(
    `SELECT cp.id, cp.position_id, cp.updated_at
     FROM constructive_packages cp
     JOIN positions p ON p.id = cp.position_id
     WHERE p.order_id = $1
     ORDER BY cp.updated_at DESC NULLS LAST, cp.id DESC
     LIMIT 12`,
    [orderId]
  )) {
    push(row);
  }

  return packages;
}

/**
 * Контекст конструктива для B3D → GLB: .project, ENVER3, готовий GLB, VRML .wrl.
 * @param {number} orderId
 * @param {{ b3dFileName?: string }} [options]
 */
export async function findConstructiveContextForOrder(orderId, { b3dFileName } = {}) {
  if (!orderId) return null;

  const packages = await collectPackagesForOrder(orderId);
  if (!packages.length) return null;

  let best = null;
  let bestScore = -1;

  for (const pkg of packages) {
    const files = await loadPackageFiles(pkg.id);
    const ranked = scorePackage(files, { b3dFileName });
    if (ranked.score > bestScore) {
      bestScore = ranked.score;
      best = { pkg, files, ranked };
    }
  }

  if (!best || bestScore < 8) return null;

  let projectBuffer = null;
  let projectName = null;
  let assemblyJsonBuffer = null;
  let existingGlbBuffer = null;
  let wrlBuffer = null;
  let wrlName = null;
  let packageB3dName = null;

  for (const file of best.files) {
    if (!projectBuffer && file.kind === "project") {
      projectBuffer = await readStoredFile(file.storage_path);
      projectName = file.original_name;
    }
    if (!assemblyJsonBuffer && file.kind === "other") {
      const lower = String(file.original_name || "").toLowerCase();
      if (lower === "enver-assembly.json" || lower.endsWith(".enver-assembly.json")) {
        assemblyJsonBuffer = await readStoredFile(file.storage_path);
      }
    }
    if (!existingGlbBuffer && file.kind === "glb_model") {
      existingGlbBuffer = await readStoredFile(file.storage_path);
    }
    if (!wrlBuffer && file.kind === "wrl_model") {
      wrlBuffer = await readStoredFile(file.storage_path);
      wrlName = file.original_name;
    }
    if (file.kind === "b3d") {
      packageB3dName = file.original_name;
    }
  }

  if (!projectBuffer && !assemblyJsonBuffer && !existingGlbBuffer && !wrlBuffer) {
    return null;
  }

  return {
    packageId: best.pkg.id,
    positionId: best.pkg.position_id,
    score: bestScore,
    projectBuffer,
    projectName,
    assemblyJsonBuffer,
    existingGlbBuffer,
    wrlBuffer,
    wrlName,
    packageB3dName
  };
}

export async function findOrderIdForAsset(assetId) {
  const row = await one(`SELECT order_id FROM order_3d_assets WHERE id = $1`, [assetId]);
  return row?.order_id ?? null;
}

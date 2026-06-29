import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getUploadsDir() {
  return config.uploadsDir || path.join(__dirname, "..", "..", "data", "uploads");
}

export function ensureUploadsDir() {
  const dir = getUploadsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function rethrowStorageError(err, action = "запису файлу") {
  if (err?.code === "EACCES" || err?.code === "EPERM") {
    const wrapped = new Error(
      `Немає прав на ${action} у ${getUploadsDir()} — перевірте UPLOADS_DIR і права Docker volume`
    );
    wrapped.status = 503;
    wrapped.expose = true;
    throw wrapped;
  }
  if (err?.code === "ENOSPC") {
    const wrapped = new Error("Недостатньо місця на диску для збереження файлу");
    wrapped.status = 507;
    wrapped.expose = true;
    throw wrapped;
  }
  throw err;
}

/** Перевірка запису в каталог завантажень (health / діагностика). */
export function probeUploadsWritable() {
  const dir = getUploadsDir();
  try {
    ensureUploadsDir();
    const probe = path.join(dir, `.probe-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, "1");
    fs.unlinkSync(probe);
    return { ok: true, dir };
  } catch (err) {
    return { ok: false, dir, error: err?.code || err?.message || String(err) };
  }
}

export function constructiveStoragePath(positionId, originalName) {
  const safe = String(originalName || "file")
    .replace(/[^\w.\-()+\u0400-\u04FF ]+/g, "_")
    .slice(0, 120);
  const stamp = Date.now();
  return path.join("constructive", String(positionId), `${stamp}-${safe}`);
}

export function packageFileStoragePath(positionId, packageId, originalName) {
  const safe = String(originalName || "file")
    .replace(/[^\w.\-()+\u0400-\u04FF ]+/g, "_")
    .slice(0, 120);
  const stamp = Date.now();
  return path.join(
    "constructive",
    String(positionId),
    "packages",
    String(packageId),
    `${stamp}-${safe}`
  );
}

export function resolveStoredPath(storagePath) {
  return path.join(getUploadsDir(), storagePath);
}

export async function saveConstructiveFile(positionId, { buffer, originalName, mime }) {
  ensureUploadsDir();
  const storagePath = constructiveStoragePath(positionId, originalName);
  const fullPath = resolveStoredPath(storagePath);
  try {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, buffer);
  } catch (err) {
    rethrowStorageError(err);
  }
  return {
    storagePath,
    originalName: originalName || "file",
    mime: mime || "application/octet-stream",
    size: buffer.length
  };
}

export async function savePackageFile(positionId, packageId, { buffer, originalName, mime }) {
  ensureUploadsDir();
  const storagePath = packageFileStoragePath(positionId, packageId, originalName);
  const fullPath = resolveStoredPath(storagePath);
  try {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, buffer);
  } catch (err) {
    rethrowStorageError(err);
  }
  return {
    storagePath,
    originalName: originalName || "file",
    mime: mime || "application/octet-stream",
    size: buffer.length
  };
}

export function readStoredFile(storagePath) {
  return fs.promises.readFile(resolveStoredPath(storagePath));
}

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
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, buffer);
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
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, buffer);
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

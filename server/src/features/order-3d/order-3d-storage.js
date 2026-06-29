import fs from "fs";
import path from "path";
import {
  ensureUploadsDir,
  resolveStoredPath,
  readStoredFile,
  rethrowStorageError
} from "../../file-storage.js";

export function order3dStoragePath(orderId, originalName) {
  const safe = String(originalName || "file")
    .replace(/[^\w.\-()+\u0400-\u04FF ]+/g, "_")
    .slice(0, 120);
  const stamp = Date.now();
  return path.join("orders", String(orderId), "3d", `${stamp}-${safe}`);
}

export async function uploadOrder3DFile(orderId, { buffer, originalName, mime }) {
  ensureUploadsDir();
  const storagePath = order3dStoragePath(orderId, originalName);
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

export { readStoredFile, resolveStoredPath };

export async function deleteStoredFile(storagePath) {
  if (!storagePath) return;
  try {
    const full = resolveStoredPath(storagePath);
    if (fs.existsSync(full)) await fs.promises.unlink(full);
  } catch {
    /* ignore */
  }
}

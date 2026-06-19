import fs from "fs";
import os from "os";
import path from "path";
import { resolveUncToMount } from "./smb-shares.js";

export function isBrowserLogPath(rawPath) {
  return String(rawPath || "")
    .trim()
    .startsWith("browser://");
}

/** Windows UNC: \\server\share або //server/share */
export function isUncPath(rawPath) {
  const s = String(rawPath || "").trim();
  return s.startsWith("\\\\") || /^\/\/[^/\\]/.test(s);
}

export function normalizeUncPath(rawPath) {
  let s = String(rawPath || "").trim();
  if (!s) return "";
  if (s.startsWith("//")) {
    s = `\\\\${s.slice(2).replace(/\//g, "\\")}`;
  } else {
    s = s.replace(/\//g, "\\");
  }
  return s.replace(/\\+$/, "");
}

/**
 * Повертає шлях для fs.* без path.resolve для UNC (на Linux resolve ламає \\NAS\share).
 * На Linux з KDT_LOG_MOUNT — UNC з БД мапиться на змонтовану SMB-шару в контейнері.
 */
export function resolveMachineLogPath(rawPath) {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed) return "";
  if (isBrowserLogPath(trimmed)) return trimmed;

  if (isUncPath(trimmed)) {
    const mount = resolveUncToMount(trimmed);
    if (mount) {
      return path.resolve(mount);
    }
    return normalizeUncPath(trimmed);
  }

  return path.resolve(trimmed);
}

export function machinePathAccessHint(rawPath) {
  if (isBrowserLogPath(rawPath)) return null;
  if (os.platform() === "win32") return null;

  if (isUncPath(rawPath)) {
    const mount = resolveUncToMount(rawPath);
    if (mount) {
      try {
        if (!fs.existsSync(mount)) {
          return `SMB-шара не змонтована (${mount}). На сервері: scripts/mount-enver-smb.sh`;
        }
      } catch {
        return `SMB-шара недоступна (${mount})`;
      }
      return null;
    }
    return (
      "Мережевий шлях Windows (\\\\server\\share) з Linux-сервера не читається напряму. " +
      "Змонтуйте SMB (scripts/mount-enver-smb.sh) або оберіть папку в Chrome на Windows-ПК."
    );
  }

  return null;
}

export function machinePathExists(resolvedPath) {
  if (!resolvedPath || isBrowserLogPath(resolvedPath)) return false;
  try {
    return fs.existsSync(resolvedPath);
  } catch {
    return false;
  }
}

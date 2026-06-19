import fs from "fs";
import os from "os";
import path from "path";
import { SMB_KDT_UNC, SMB_LOG_UNC, resolveUncToMount } from "./smb-shares.js";

export function isBrowserLogPath(rawPath) {
  return String(rawPath || "")
    .trim()
    .startsWith("browser://");
}

/** Windows UNC: \\server\share, //server/share, або пошкоджений \192.168.x.x\share */
export function isUncPath(rawPath) {
  const s = String(rawPath || "").trim();
  if (!s) return false;
  if (s.startsWith("\\\\")) return true;
  if (/^\/\/[^/\\]/.test(s)) return true;
  if (/^\\[^\\]+\\/.test(s)) return true;
  if (/^\\?\d{1,3}(?:\.\d{1,3}){3}[\\/]/.test(s)) return true;
  if (/192\.168\.1\.203/i.test(s) && /(KDTsaw|Log)/i.test(s)) return true;
  return false;
}

/** Відновлює коректний UNC (зокрема після з'їденого \L у рядках). */
export function normalizeUncPath(rawPath) {
  let s = String(rawPath || "").trim();
  if (!s) return "";

  const compact = s.replace(/\\/g, "").toLowerCase();
  if (compact === "192.168.1.203log" || compact.endsWith("192.168.1.203log")) {
    return SMB_LOG_UNC;
  }
  if (compact === "192.168.1.203kdtsaw" || compact.endsWith("192.168.1.203kdtsaw")) {
    return SMB_KDT_UNC;
  }

  if (s.startsWith("//")) {
    s = `\\\\${s.slice(2).replace(/\//g, "\\")}`;
  } else {
    s = s.replace(/\//g, "\\");
  }

  if (s.startsWith("\\") && !s.startsWith("\\\\")) {
    s = `\\${s}`;
  }

  return s.replace(/\\+$/, "");
}

/**
 * Шлях для fs.* — UNC ніколи не проходить через path.resolve (на macOS це дає server/\\NAS\...).
 */
export function resolveMachineStoragePath(rawPath) {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed) return "";
  if (isBrowserLogPath(trimmed)) return trimmed;

  if (isUncPath(trimmed)) {
    const normalized = normalizeUncPath(trimmed);
    const mount = resolveUncToMount(normalized);
    if (mount) return path.resolve(mount);
    return normalized;
  }

  return path.resolve(trimmed);
}

export const resolveMachineLogPath = resolveMachineStoragePath;

export function machinePathAccessHint(rawPath) {
  if (isBrowserLogPath(rawPath)) return null;
  if (os.platform() === "win32") return null;

  if (isUncPath(rawPath)) {
    const normalized = normalizeUncPath(rawPath);
    const mount = resolveUncToMount(normalized);
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
      "Мережевий шлях Windows недоступний з цього сервера. " +
      "Змонтуйте SMB або оберіть папку в Chrome на Windows-ПК."
    );
  }

  return null;
}

export function machinePathExists(resolvedPath) {
  if (!resolvedPath || isBrowserLogPath(resolvedPath)) return false;
  if (isUncPath(resolvedPath)) return false;
  try {
    return fs.existsSync(resolvedPath);
  } catch {
    return false;
  }
}

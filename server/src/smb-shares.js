import fs from "fs";
import os from "os";

/** Мережеві шари цеху (Windows UNC). */
export const SMB_HOST_DEFAULT = "192.168.1.203";
export const SMB_KDT_UNC = `\\\\${SMB_HOST_DEFAULT}\\KDTsaw`;
export const SMB_LOG_UNC = `\\\\${SMB_HOST_DEFAULT}\\Log`;

export function smbHost() {
  return String(process.env.SMB_HOST || SMB_HOST_DEFAULT).trim();
}

export function kdtLogMount() {
  return String(process.env.KDT_LOG_MOUNT || "/mnt/kdtsaw").trim();
}

export function enverLogMount() {
  return String(process.env.ENVER_LOG_MOUNT || "/mnt/enver-log").trim();
}

function uncKey(rawPath) {
  let s = String(rawPath || "").trim();
  if (s.startsWith("//")) {
    s = `\\\\${s.slice(2).replace(/\//g, "\\")}`;
  } else {
    s = s.replace(/\//g, "\\");
  }
  return s.replace(/\\+$/, "").toLowerCase();
}

/** Розпізнає відомі UNC незалежно від регістру (KDTsaw / KDTSaw). */
export function resolveUncToMount(rawPath) {
  if (os.platform() === "win32") return null;

  const normalized = uncKey(rawPath);
  if (!normalized.startsWith("\\\\")) return null;

  const host = smbHost().toLowerCase();
  if (normalized === `\\\\${host}\\kdtsaw`) return kdtLogMount();
  if (normalized === `\\\\${host}\\log`) return enverLogMount();

  return null;
}

export function verifySmbMounts() {
  if (os.platform() === "win32") return [];

  const warnings = [];
  const pairs = [
    [SMB_KDT_UNC, kdtLogMount()],
    [SMB_LOG_UNC, enverLogMount()]
  ];

  for (const [unc, mount] of pairs) {
    if (!mount) continue;
    try {
      if (!fs.existsSync(mount)) {
        warnings.push(`SMB ${unc} → ${mount} не змонтовано (запустіть scripts/mount-enver-smb.sh)`);
      }
    } catch {
      warnings.push(`SMB ${unc} → ${mount} недоступний`);
    }
  }

  return warnings;
}

export function logSmbMountStatus() {
  for (const msg of verifySmbMounts()) {
    console.warn(`[smb] ${msg}`);
  }
}

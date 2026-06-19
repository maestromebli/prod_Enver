import { execFileSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import path from "path";

/**
 * Відкриває системний діалог вибору папки на Windows (локальний диск або мережа \\NAS\...).
 * Працює лише коли Node-процес має доступ до робочого столу (не Docker без GUI).
 */
export function pickWindowsFolder({ title = "Оберіть папку" } = {}) {
  if (process.platform !== "win32") {
    const err = new Error("Діалог папки доступний лише на Windows");
    err.status = 501;
    throw err;
  }

  const safeTitle = String(title).replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$b = New-Object System.Windows.Forms.FolderBrowserDialog
$b.Description = '${safeTitle}'
$b.ShowNewFolderButton = $true
if ($b.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $b.SelectedPath
}
`;

  const tmp = path.join(tmpdir(), `enver-folder-pick-${Date.now()}.ps1`);
  writeFileSync(tmp, script, "utf8");
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-STA", "-File", tmp], {
      encoding: "utf8",
      timeout: 120_000,
      windowsHide: false
    }).trim();
    return out || null;
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

export function windowsFolderPickerAvailable() {
  return process.platform === "win32";
}

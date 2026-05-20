import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildIpadInstallProfile } from "../ipad-install-profile.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const releasesDir = path.join(__dirname, "..", "..", "..", "releases");
const WINDOWS_ZIP = "enver-operator-windows.zip";
const IPAD_PROFILE = "enver-operator-ipad.mobileconfig";

function windowsZipPath() {
  return path.join(releasesDir, WINDOWS_ZIP);
}

router.get("/info", requireAuth, requireAdmin, (req, res) => {
  const proto = req.get("x-forwarded-proto") || req.protocol;
  const host = req.get("x-forwarded-host") || req.get("host");
  const base = `${proto}://${host}`;
  const zipPath = windowsZipPath();
  const available = fs.existsSync(zipPath);

  res.json({
    operatorUrl: `${base}/operator.html`,
    ipadDownloadUrl: `${base}/downloads/${IPAD_PROFILE}`,
    ipadDownloadAvailable: true,
    ipadFileName: IPAD_PROFILE,
    windowsDownloadUrl: `${base}/downloads/${WINDOWS_ZIP}`,
    windowsDownloadAvailable: available,
    windowsFileName: WINDOWS_ZIP
  });
});

export default router;

function requestBaseUrl(req) {
  const proto = req.get("x-forwarded-proto") || req.protocol;
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}

export function registerDownloadRoutes(app) {
  app.get("/downloads/:filename", (req, res) => {
    const safe = path.basename(req.params.filename);

    if (safe === IPAD_PROFILE) {
      const operatorUrl = `${requestBaseUrl(req)}/operator.html`;
      const body = buildIpadInstallProfile(operatorUrl);
      res.setHeader("Content-Type", "application/x-apple-aspen-config; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${IPAD_PROFILE}"`);
      res.send(body);
      return;
    }

    if (safe !== WINDOWS_ZIP) {
      res.status(404).json({ error: "Файл не знайдено" });
      return;
    }
    const filePath = path.join(releasesDir, safe);
    if (!fs.existsSync(filePath)) {
      res.status(404).send("Архів Windows ще не зібрано. На сервері: npm run build:windows-client");
      return;
    }
    res.download(filePath, safe);
  });
}

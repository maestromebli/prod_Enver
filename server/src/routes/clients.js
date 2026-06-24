import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const releasesDir = path.join(__dirname, "..", "..", "..", "releases");
const ANDROID_APK = "enver-operator-android.apk";

function androidApkPath() {
  return path.join(releasesDir, ANDROID_APK);
}

function requestBaseUrl(req) {
  const proto = req.get("x-forwarded-proto") || req.protocol;
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}

router.get("/info", requireAuth, requireAdmin, (req, res) => {
  const base = requestBaseUrl(req);
  const apkPath = androidApkPath();
  const available = fs.existsSync(apkPath);
  const build = config.buildSha || "latest";
  const cacheBust = available ? String(fs.statSync(apkPath).mtimeMs) : build;

  res.json({
    operatorUrl: `${base}/operator.html`,
    androidInstallUrl: `${base}/android-install.html`,
    androidDownloadUrl: `${base}/downloads/${ANDROID_APK}?v=${encodeURIComponent(cacheBust)}`,
    androidDownloadAvailable: available,
    androidFileName: ANDROID_APK,
    androidBuild: build,
    androidHint: "Завантажте APK і встановіть на планшет Android"
  });
});

export default router;

export function registerDownloadRoutes(app) {
  app.get("/downloads/:filename", (req, res) => {
    const safe = path.basename(req.params.filename);
    if (safe !== ANDROID_APK) {
      res.status(404).json({ error: "Файл не знайдено" });
      return;
    }

    const filePath = androidApkPath();
    if (!fs.existsSync(filePath)) {
      res.status(404).send("APK ще не зібрано. На сервері: npm run build:android-client");
      return;
    }

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.download(filePath, safe);
  });
}

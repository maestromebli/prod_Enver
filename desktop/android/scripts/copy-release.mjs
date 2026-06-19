import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const apkSrc = path.join(root, "app", "build", "outputs", "apk", "release", "app-release.apk");
const outDir = path.join(root, "..", "..", "releases");
const outApk = path.join(outDir, "enver-operator-android.apk");

if (!fs.existsSync(apkSrc)) {
  console.error("APK не знайдено:", apkSrc);
  console.error("Спочатку: cd desktop/android && ./gradlew assembleRelease");
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(apkSrc, outApk);
console.log("Скопійовано:", outApk);

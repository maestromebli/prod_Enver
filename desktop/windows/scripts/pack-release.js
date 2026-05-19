const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..", "..", "..");
const buildDir = path.join(root, "releases", "windows-build");
const outZip = path.join(root, "releases", "enver-operator-windows.zip");
const configExample = path.join(__dirname, "..", "config.default.json");

function findPortableExe(dir) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.endsWith(".exe")) return full;
    if (e.isDirectory()) {
      const nested = findPortableExe(full);
      if (nested) return nested;
    }
  }
  return null;
}

const exe = findPortableExe(buildDir);
if (!exe) {
  console.error("Не знайдено ENVER Operator.exe після збірки. Спочатку: npm run build");
  process.exit(1);
}

const staging = path.join(root, "releases", "_windows-staging");
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

fs.copyFileSync(exe, path.join(staging, "ENVER Operator.exe"));
fs.copyFileSync(configExample, path.join(staging, "config.json"));
fs.writeFileSync(
  path.join(staging, "README.txt"),
  `ENVER Operator — клієнт для Windows

1. Відредагуйте config.json — вкажіть serverUrl (наприклад http://192.168.1.10:3001).
2. Запустіть ENVER Operator.exe.
3. Автозапуск увімкнеться автоматично.
4. Вихід з повноекранного: кнопка в шапці + пароль 1111 (за замовчуванням).
`,
  "utf8"
);

fs.mkdirSync(path.dirname(outZip), { recursive: true });
if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

const isWin = process.platform === "win32";
if (isWin) {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${staging}\\*' -DestinationPath '${outZip}' -Force"`,
    { stdio: "inherit" }
  );
} else {
  execSync(`cd "${staging}" && zip -r "${outZip}" .`, { stdio: "inherit" });
}

fs.rmSync(staging, { recursive: true, force: true });
console.log("Архів:", outZip);

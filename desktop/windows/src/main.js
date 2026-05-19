const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const AutoLaunch = require("auto-launch");

const KIOSK_EXIT_PASSWORD = "1111";

let mainWindow = null;

function configPaths() {
  const portableDir = path.dirname(process.execPath);
  const userDir = app.getPath("userData");
  return {
    portable: path.join(portableDir, "config.json"),
    user: path.join(userDir, "config.json"),
    default: path.join(__dirname, "..", "config.default.json")
  };
}

function loadConfig() {
  const paths = configPaths();
  const defaults = {
    serverUrl: "http://127.0.0.1:3001",
    kioskExitPassword: KIOSK_EXIT_PASSWORD,
    autoLaunch: true
  };

  let raw = null;
  if (fs.existsSync(paths.portable)) raw = fs.readFileSync(paths.portable, "utf8");
  else if (fs.existsSync(paths.user)) raw = fs.readFileSync(paths.user, "utf8");
  else if (fs.existsSync(paths.default)) raw = fs.readFileSync(paths.default, "utf8");

  if (!raw) return defaults;
  try {
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

function operatorUrl(config) {
  const base = String(config.serverUrl || "").replace(/\/$/, "");
  return `${base}/operator.html`;
}

async function setupAutoLaunch(enabled) {
  if (!enabled || process.platform !== "win32") return;
  const launcher = new AutoLaunch({
    name: "ENVER Operator",
    path: process.execPath,
    isHidden: false
  });
  try {
    const isEnabled = await launcher.isEnabled();
    if (!isEnabled) await launcher.enable();
  } catch (err) {
    console.warn("Автозапуск:", err.message);
  }
}

function createWindow() {
  const config = loadConfig();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: true,
    kiosk: true,
    autoHideMenuBar: true,
    backgroundColor: "#0f2a44",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setMenu(null);
  mainWindow.loadURL(operatorUrl(config));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F11" || (input.alt && input.key === "Enter")) {
      event.preventDefault();
    }
  });

  setupAutoLaunch(config.autoLaunch !== false);
}

ipcMain.handle("kiosk:request-exit", async () => {
  const config = loadConfig();
  const expected = String(config.kioskExitPassword || KIOSK_EXIT_PASSWORD);

  const { response, checkboxChecked } = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["Скасувати", "Вийти з повноекранного"],
    defaultId: 0,
    cancelId: 0,
    title: "ENVER Operator",
    message: "Вихід з повноекранного режиму",
    detail: "Введіть пароль у наступному вікні.",
    checkboxLabel: "Закрити програму після виходу",
    checkboxChecked: false
  });

  if (response !== 1) return { ok: false };

  const pwd = await promptPassword();
  if (pwd !== expected) {
    await dialog.showErrorBox("ENVER Operator", "Невірний пароль");
    return { ok: false };
  }

  if (mainWindow) {
    mainWindow.setKiosk(false);
    mainWindow.setFullScreen(false);
    if (checkboxChecked) {
      app.quit();
    }
  }
  return { ok: true };
});

function promptPassword() {
  return new Promise((resolve) => {
    const promptWin = new BrowserWindow({
      width: 360,
      height: 180,
      parent: mainWindow,
      modal: true,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    const html = `<!DOCTYPE html><html lang="uk"><body style="font-family:Segoe UI,sans-serif;padding:16px">
      <p style="margin:0 0 8px">Пароль для виходу:</p>
      <input id="p" type="password" style="width:100%;padding:8px;box-sizing:border-box" autofocus />
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
        <button id="c">Скасувати</button>
        <button id="o">OK</button>
      </div>
      <script>
        const { ipcRenderer } = require('electron');
        document.getElementById('o').onclick = () => ipcRenderer.send('pwd', document.getElementById('p').value);
        document.getElementById('c').onclick = () => ipcRenderer.send('pwd', null);
        document.getElementById('p').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('o').click(); };
      </script>
    </body></html>`;

    promptWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    promptWin.once("ready-to-show", () => promptWin.show());

    const handler = (_e, value) => {
      ipcMain.removeListener("pwd", handler);
      promptWin.close();
      resolve(value);
    };
    ipcMain.on("pwd", handler);
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

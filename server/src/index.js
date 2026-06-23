import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { pool, shutdownDb } from "./db.js";
import { createApiApp } from "./app.js";
import { assertProductionSafety, config } from "./config.js";
import { ensureUploadsDir } from "./file-storage.js";

const PORT = config.port;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(__dirname, "..", "..", "client");
const clientDist = path.join(clientRoot, "dist");
const isDev = process.env.NODE_ENV !== "production";

let httpServer = null;
let viteDevServer = null;
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  const done = () => {
    shutdownDb().finally(() => {
      if (signal) {
        console.log(`\nЗупинка (${signal})…`);
      }
      process.exit(0);
    });
  };

  const closeVite = viteDevServer ? viteDevServer.close().catch(() => {}) : Promise.resolve();

  closeVite.finally(() => {
    if (httpServer) {
      httpServer.close(done);
      setTimeout(done, 2000).unref();
    } else {
      done();
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

async function start() {
  assertProductionSafety();
  ensureUploadsDir();

  let dbConfigured = Boolean(process.env.DATABASE_URL);
  let dbConnected = false;

  if (!dbConfigured) {
    if (!isDev) {
      console.error("DATABASE_URL не задано. Сервер не може стартувати без БД.");
      process.exit(1);
    }
    console.warn("DATABASE_URL не задано. Dev-сервер запущено без доступу до БД.");
  } else {
    try {
      await pool.query("SELECT 1");
      dbConnected = true;
    } catch (err) {
      if (!isDev) throw err;
      const hint =
        /[<>]/.test(process.env.DATABASE_URL || "") ||
        /<project-ref>|<password>|<region>/.test(process.env.DATABASE_URL || "")
          ? " У .env залишились шаблонні плейсхолдери (<project-ref> тощо) — вставте реальний connection string або запустіть локальну БД: npm run dev:db"
          : "";
      console.warn(`Підключення до БД недоступне: ${err.message}.${hint}`);
      console.warn("Dev-сервер запущено без доступу до БД. Перевірте DATABASE_URL у .env.");
    }
  }

  const app = createApiApp({ dbConfigured, dbConnected });
  const server = http.createServer(app);
  httpServer = server;

  if (isDev) {
    try {
      const { createServer } = await import("vite");
      viteDevServer = await createServer({
        root: clientRoot,
        appType: "spa",
        resolve: {
          alias: {
            "@enver/shared": path.join(clientRoot, "..", "shared")
          }
        },
        server: {
          middlewareMode: true,
          hmr: { server, port: PORT },
          watch: { usePolling: false }
        }
      });
      app.use(viteDevServer.middlewares);
    } catch (err) {
      console.error("Не вдалося запустити Vite:", err.message);
      console.error("Виконайте: npm install --prefix server");
      process.exit(1);
    }
  } else {
    app.use((req, res, next) => {
      if (
        req.path === "/" ||
        req.path === "/index.html" ||
        req.path === "/operator.html" ||
        req.path === "/android-install.html" ||
        req.path === "/manifest-operator.webmanifest" ||
        req.path === "/sw-operator.js" ||
        req.path.startsWith("/assets/")
      ) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.setHeader("Pragma", "no-cache");
      }
      next();
    });
    app.use(express.static(clientDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) {
        next();
        return;
      }
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.sendFile(path.join(clientDist, "index.html"), (err) => {
        if (err) next(err);
      });
    });
  }

  await new Promise((resolve, reject) => {
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `Порт ${PORT} зайнятий. Зупиніть інший процес:\n  lsof -ti :${PORT} | xargs kill -9\nабо: PORT=3001 npm run dev`
        );
      } else {
        console.error(err);
      }
      reject(err);
    });

    server.listen(PORT, () => {
      server.off("error", reject);
      console.log(`ENVER: http://localhost:${PORT}`);
      if (isDev) {
        console.log("Режим розробки — відкривайте саме цю адресу (не :5173)");
      }
      resolve();
    });
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});

import express from "express";
import "express-async-errors";
import cors from "cors";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { pool, shutdownDb } from "./db.js";
import ordersRouter from "./routes/orders.js";
import positionsRouter from "./routes/positions.js";
import kpisRouter from "./routes/kpis.js";
import directoriesRouter from "./routes/directories.js";
import historyRouter from "./routes/history.js";
import authRouter from "./routes/auth.js";
import usersRouter from "./routes/users.js";
import machineRouter from "./routes/machine.js";
import machineLogsRouter from "./routes/machine-logs.js";
import settingsRouter from "./routes/settings.js";
import operatorRouter from "./routes/operator.js";
import productionRouter from "./routes/production.js";
import clientsRouter, { registerDownloadRoutes } from "./routes/clients.js";
import folderAgentRouter from "./routes/folder-agent.js";
import aiEstimateRouter from "./routes/ai-estimate.js";
import { config } from "./config.js";
import { apiError } from "./http/api-response.js";
import { apiFormatMiddleware } from "./http/api-format-middleware.js";
import { startMachineLogWatchers, stopMachineLogWatchers } from "./machine-log-watcher.js";

const PORT = config.port;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(__dirname, "..", "..", "client");
const clientDist = path.join(clientRoot, "dist");
const isDev = process.env.NODE_ENV !== "production";

let httpServer = null;
let viteDevServer = null;
let shuttingDown = false;

function createApiApp({ dbConfigured, dbConnected }) {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use("/api", apiFormatMiddleware);

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      data: {
        build: config.buildSha,
        production: config.isProduction,
        database: { configured: dbConfigured, connected: dbConnected },
        features: {
          machineLogs: dbConnected,
          aiMatching: dbConnected,
          folderAgent: dbConnected,
          cuttingEstimate: dbConnected
        }
      }
    });
  });

  app.use("/api/orders", ordersRouter);
  app.use("/api/positions", positionsRouter);
  app.use("/api/kpis", kpisRouter);
  app.use("/api/directories", directoriesRouter);
  app.use("/api/history", historyRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/machine", machineRouter);
  app.use("/api/machine/logs", machineLogsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/operator", operatorRouter);
  app.use("/api/production", productionRouter);
  app.use("/api/clients", clientsRouter);
  app.use("/api/folder-agent", folderAgentRouter);
  app.use("/api/ai", aiEstimateRouter);

  registerDownloadRoutes(app);

  app.use((err, _req, res, _next) => {
    console.error(err);
    const status = Number.isInteger(err?.status) ? err.status : 500;
    const code = err?.code || (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR");
    const message =
      status >= 500 && !err?.expose ? "Внутрішня помилка сервера" : err?.message || "Помилка";
    res.status(status).json(apiError(code, message));
  });

  return app;
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  const done = () => {
    stopMachineLogWatchers();
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
      // Перевірка з'єднання з БД — швидкий fail, якщо DATABASE_URL невалідний.
      await pool.query("SELECT 1");
      dbConnected = true;
    } catch (err) {
      if (!isDev) throw err;
      console.warn(`Підключення до БД недоступне: ${err.message}`);
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
        req.path === "/operator.html" ||
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
      if (dbConnected) {
        startMachineLogWatchers();
      } else {
        console.warn("Machine log watcher вимкнено: немає підключення до БД.");
      }
      resolve();
    });
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});

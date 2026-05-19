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
import { startMachineLogWatchers, stopMachineLogWatchers } from "./machine-log-watcher.js";

const PORT = Number(process.env.PORT) || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(__dirname, "..", "..", "client");
const clientDist = path.join(clientRoot, "dist");
const isDev = process.env.NODE_ENV !== "production";

let httpServer = null;
let viteDevServer = null;
let shuttingDown = false;

function createApiApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      production: process.env.NODE_ENV === "production",
      features: { machineLogs: true, aiMatching: true }
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
  registerDownloadRoutes(app);

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Внутрішня помилка сервера" });
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
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL не задано. Сервер не може стартувати без БД.");
    process.exit(1);
  }
  // Перевірка з'єднання з БД — швидкий fail, якщо DATABASE_URL невалідний.
  await pool.query("SELECT 1");

  const app = createApiApp();
  const server = http.createServer(app);
  httpServer = server;

  if (isDev) {
    try {
      const { createServer } = await import("vite");
      viteDevServer = await createServer({
        root: clientRoot,
        appType: "spa",
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
      startMachineLogWatchers();
      resolve();
    });
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});

import express from "express";
import "express-async-errors";
import cors from "cors";
import helmet from "helmet";
import ordersRouter from "./routes/orders.js";
import positionsRouter from "./routes/positions.js";
import kpisRouter from "./routes/kpis.js";
import directoriesRouter from "./routes/directories.js";
import historyRouter from "./routes/history.js";
import authRouter from "./routes/auth.js";
import usersRouter from "./routes/users.js";
import settingsRouter from "./routes/settings.js";
import operatorRouter from "./routes/operator.js";
import productionRouter from "./routes/production.js";
import clientsRouter, { registerDownloadRoutes } from "./routes/clients.js";
import aiRouter from "./routes/ai.js";
import notificationsRouter from "./routes/notifications.js";
import { config } from "./config.js";
import { apiError } from "./http/api-response.js";
import { apiFormatMiddleware } from "./http/api-format-middleware.js";

function buildCorsOptions() {
  if (!config.isProduction) return undefined;
  const origins = [];
  if (config.domain) {
    origins.push(`https://${config.domain}`, `http://${config.domain}`);
  }
  if (origins.length === 0) {
    return { origin: false };
  }
  return { origin: origins, credentials: true };
}

export function createApiApp({ dbConfigured, dbConnected }) {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    })
  );
  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: "6mb" }));
  app.use("/api", apiFormatMiddleware);

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      data: {
        build: config.buildSha,
        production: config.isProduction,
        database: { configured: dbConfigured, connected: dbConnected },
        features: {
          constructiveAi: dbConnected,
          fileUploads: dbConnected
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
  app.use("/api/settings", settingsRouter);
  app.use("/api/operator", operatorRouter);
  app.use("/api/production", productionRouter);
  app.use("/api/clients", clientsRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/notifications", notificationsRouter);

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

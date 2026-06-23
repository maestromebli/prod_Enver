const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const INSECURE_DEFAULTS = {
  sessionSecret: "enver-dev-secret"
};

export const config = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction: process.env.NODE_ENV === "production",
  isDev: process.env.NODE_ENV !== "production",
  databaseUrl: process.env.DATABASE_URL || null,
  sessionSecret: process.env.SESSION_SECRET || INSECURE_DEFAULTS.sessionSecret,
  sessionTtlMs: SESSION_TTL_MS,
  openaiApiKey: process.env.OPENAI_API_KEY || null,
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  domain: process.env.DOMAIN || null,
  adminDefaultPassword: process.env.ADMIN_DEFAULT_PASSWORD || null,
  buildSha: process.env.APP_BUILD_SHA || process.env.IMAGE_TAG || null,
  uploadsDir: process.env.UPLOADS_DIR || null
};

/** У production перевіряє критичну конфігурацію; небезпечні секрети — попередження (не ламаємо існуючі .env). */
export function assertProductionSafety() {
  if (!config.isProduction) return;

  if (!config.databaseUrl) {
    console.error("DATABASE_URL обов'язковий у production");
    process.exit(1);
  }

  const warnings = [];
  if (!process.env.SESSION_SECRET || config.sessionSecret === INSECURE_DEFAULTS.sessionSecret) {
    warnings.push(
      "SESSION_SECRET — дефолтне dev-значення; задайте власний секрет у /opt/enver/.env"
    );
  }
  for (const message of warnings) {
    console.warn(`[security] ${message}`);
  }
}

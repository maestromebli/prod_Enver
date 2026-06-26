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
  uploadsDir: process.env.UPLOADS_DIR || null,
  /** Ліміт JSON-тіла (base64-завантаження). Перевизначити через JSON_BODY_LIMIT. */
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || "200mb"
};

/** Помилки безпеки production — для assertProductionSafety і тестів. */
export function getProductionSecurityErrors(cfg = config) {
  const errors = [];
  if (!cfg.isProduction) return errors;

  if (!process.env.SESSION_SECRET || cfg.sessionSecret === INSECURE_DEFAULTS.sessionSecret) {
    errors.push(
      "SESSION_SECRET обов'язковий у production — задайте власний секрет (не enver-dev-secret)"
    );
  }
  if (process.env.ADMIN_DEFAULT_PASSWORD === "admin") {
    errors.push(
      "ADMIN_DEFAULT_PASSWORD=admin заборонено у production — задайте надійний пароль адміністратора"
    );
  }
  return errors;
}

/** У production перевіряє критичну конфігурацію; небезпечні секрети — fail-fast. */
export function assertProductionSafety() {
  if (!config.isProduction) return;

  if (!config.databaseUrl) {
    console.error("DATABASE_URL обов'язковий у production");
    process.exit(1);
  }

  const securityErrors = getProductionSecurityErrors();
  if (securityErrors.length > 0) {
    for (const message of securityErrors) {
      console.error(`[security] ${message}`);
    }
    process.exit(1);
  }
}

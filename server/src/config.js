const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const INSECURE_DEFAULTS = {
  sessionSecret: "enver-dev-secret",
  agentToken: "enver-agent-dev-token"
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
  agentToken: process.env.AGENT_TOKEN || INSECURE_DEFAULTS.agentToken,
  adminDefaultPassword: process.env.ADMIN_DEFAULT_PASSWORD || null,
  buildSha: process.env.APP_BUILD_SHA || process.env.IMAGE_TAG || null
};

/** У production забороняє старт із дефолтними або відсутніми секретами. */
export function assertProductionSafety() {
  if (!config.isProduction) return;

  const errors = [];
  if (!config.databaseUrl) {
    errors.push("DATABASE_URL обов'язковий у production");
  }
  if (!process.env.SESSION_SECRET || config.sessionSecret === INSECURE_DEFAULTS.sessionSecret) {
    errors.push("SESSION_SECRET має бути заданий і відмінний від дефолтного dev-значення");
  }
  if (!process.env.AGENT_TOKEN || config.agentToken === INSECURE_DEFAULTS.agentToken) {
    errors.push("AGENT_TOKEN має бути заданий і відмінний від дефолтного dev-значення");
  }

  if (errors.length === 0) return;

  console.error("Небезпечна production-конфігурація:");
  for (const message of errors) {
    console.error(`  • ${message}`);
  }
  process.exit(1);
}

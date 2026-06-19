const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const config = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction: process.env.NODE_ENV === "production",
  isDev: process.env.NODE_ENV !== "production",
  databaseUrl: process.env.DATABASE_URL || null,
  sessionSecret: process.env.SESSION_SECRET || "enver-dev-secret",
  sessionTtlMs: SESSION_TTL_MS,
  openaiApiKey: process.env.OPENAI_API_KEY || null,
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  domain: process.env.DOMAIN || null,
  agentToken: process.env.AGENT_TOKEN || "enver-agent-dev-token",
  adminDefaultPassword: process.env.ADMIN_DEFAULT_PASSWORD || null,
  buildSha: process.env.APP_BUILD_SHA || process.env.IMAGE_TAG || null
};

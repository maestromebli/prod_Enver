import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT) || 3010;
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_SKIP_SERVER
    ? undefined
    : {
        command: "npm run dev",
        url: `${baseURL}/api/health`,
        reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
        timeout: 120_000,
        env: {
          ...process.env,
          NODE_ENV: "development",
          PORT: String(port)
        }
      }
});

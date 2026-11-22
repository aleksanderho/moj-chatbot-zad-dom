import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3217", channel: "msedge", headless: true },
  webServer: {
    command: "node --import ./tests/fixtures/history-services.mjs node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3217",
    url: "http://127.0.0.1:3217",
    reuseExistingServer: false,
    env: {
      SUPABASE_URL: "https://database.example.test",
      SUPABASE_SECRET_KEY: "test-secret",
      OPENROUTER_API_KEY: "test-key",
      OPENROUTER_MODEL: "test/model",
      TRAVEL_SESSION_SECRET: "history-browser-test",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});

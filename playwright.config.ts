// The desktop smoke ring (G2): the five load-bearing screens rendered by the
// REAL frontend bundle with the Tauri IPC mocked (e2e/tauri-mock.ts). This is
// deliberately not a full Tauri e2e (tauri-driver has no macOS support): it
// catches React regressions - broken screens, dead buttons, crashed sections -
// which is where the desktop was shipping blind. Runs in release CI before the
// tag builds.
//
// The performance budgets (e2e/perf.spec.ts) are about the bundle people run,
// so they get their own project over a production build; development-mode
// React is several times slower and would measure the wrong thing.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: "app", testIgnore: /perf\.spec\.ts/, use: { baseURL: "http://localhost:1420" } },
    { name: "perf", testMatch: /perf\.spec\.ts/, use: { baseURL: "http://localhost:1421" } },
  ],
  webServer: [
    {
      command: "npx vite --port 1420 --strictPort",
      url: "http://localhost:1420",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "npx vite build && npx vite preview --port 1421 --strictPort",
      url: "http://localhost:1421",
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});

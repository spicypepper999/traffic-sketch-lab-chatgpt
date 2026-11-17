import { defineConfig, devices } from '@playwright/test';

// These tests launch a real Firefox browser and exercise the running game.
// Unlike Node-only geometry tests, they catch DOM, Canvas, worker and input bugs.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: {timeout: 10_000},
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', {open: 'never'}]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{name:'firefox', use: {...devices['Desktop Firefox'], viewport: {width:1600,height:900}}}],
  webServer: {
    command: 'node serve.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});

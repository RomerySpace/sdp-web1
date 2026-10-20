import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: 'session-reliability.spec.ts', workers: 1,
  timeout: 120000, expect: { timeout: 15000 }, outputDir: 'test-results/session',
  use: { viewport: { width: 1440, height: 1000 }, launchOptions: { channel: 'chrome' }, screenshot: 'only-on-failure', trace: 'retain-on-failure' } });

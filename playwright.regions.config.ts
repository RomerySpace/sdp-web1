import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'regions.spec.ts', workers: 1, fullyParallel: false,
  timeout: 240000, expect: { timeout: 20000 }, reporter: 'list', outputDir: 'test-results/regions',
  use: { viewport: { width: 1200, height: 850 }, actionTimeout: 20000, navigationTimeout: 30000, screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } },
});

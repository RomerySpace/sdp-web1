import { defineConfig } from '@playwright/test';
import unified from './playwright.unified.config';
export default defineConfig({ ...unified, testMatch: 'shooter-disabled.spec.ts', outputDir: 'test-results/disabled',
  use: { ...unified.use, baseURL: 'http://localhost:5393' },
  webServer: { command: 'npm run dev:unified', url: 'http://localhost:5393', reuseExistingServer: false, timeout: 90000,
    env: { SDP_WEB_PORT: '5393', PORT: '2607', SDP_LOCAL_VOICE: '0', ENABLE_SHOOTER_TEST: 'false' } },
});

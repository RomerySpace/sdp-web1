import { defineConfig } from '@playwright/test';
import original from './playwright.config';
process.env.SDP_TEST_SERVER_PORT ||= '2597';
export default defineConfig({ ...original,
  outputDir: 'test-results/regression',
  testMatch: ['experience.spec.ts', 'multiplayer.spec.ts', 'graphics.spec.ts', 'audio.spec.ts', 'inspection.spec.ts'],
  use: { ...original.use, baseURL: 'http://localhost:5383' },
  webServer: { command: 'npm run dev:unified', url: 'http://localhost:5383',
    env: { SDP_WEB_PORT: '5383', PORT: '2597', LIVEKIT_PORT: '7990', LIVEKIT_RTC_TCP_PORT: '7991', LIVEKIT_RTC_UDP_PORT: '7992' },
    reuseExistingServer: !process.env.CI, timeout: 90000 },
});

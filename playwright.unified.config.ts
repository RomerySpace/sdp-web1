import { defineConfig } from '@playwright/test';
// @ts-expect-error Node-only audio fixture generator.
import { voiceFixture } from './scripts/test-voice-fixture.mjs';
export default defineConfig({
  testDir: './tests', testMatch: ['unified.spec.ts', 'unified-production.spec.ts', 'touch.spec.ts'], workers: 1, fullyParallel: false,
  outputDir: 'test-results/unified',
  timeout: 180000, expect: { timeout: 30000 }, reporter: 'list',
  use: { baseURL: process.env.SDP_UNIFIED_TEST_URL || 'http://localhost:5383', viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: { channel: 'chrome',
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${voiceFixture(process.cwd())}`] } },
  webServer: { command: 'npm run dev:unified', url: process.env.SDP_UNIFIED_TEST_URL || 'http://localhost:5383',
    env: { SDP_WEB_PORT: '5383', PORT: '2597', LIVEKIT_PORT: '7990', LIVEKIT_RTC_TCP_PORT: '7991', LIVEKIT_RTC_UDP_PORT: '7992' },
    reuseExistingServer: !process.env.CI, timeout: 90000 },
});

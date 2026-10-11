import { defineConfig } from '@playwright/test';
// @ts-expect-error Small Node-only test asset generator, not frontend code.
import { voiceFixture } from './scripts/test-voice-fixture.mjs';

const lan = process.env.SDP_TEST_LAN === '1';
const webPort = process.env.SDP_TEST_WEB_PORT || '5173';
const backendPort = process.env.SDP_TEST_SERVER_PORT || '2567';
const baseURL = `${lan ? 'https' : 'http'}://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 15000 },
  reporter: 'list',
  use: {
    baseURL,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      // Uses the user's installed Chrome; no additional browser download.
      channel: 'chrome',
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
        ...(lan ? [`--use-file-for-fake-audio-capture=${voiceFixture(process.cwd())}`] : [])],
    },
  },
  webServer: lan ? [{
    command: 'npm run dev:lan',
    url: baseURL,
    env: { SDP_WEB_PORT: webPort, PORT: backendPort },
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  }] : [{
    command: 'npm --prefix server start',
    url: `http://127.0.0.1:${process.env.SDP_TEST_SERVER_PORT || 2567}/health`,
    env: { PORT: process.env.SDP_TEST_SERVER_PORT || '2567', HOST: '127.0.0.1' },
    reuseExistingServer: !process.env.CI && !process.env.SDP_TEST_SERVER_PORT,
    timeout: 30000,
  }, {
    command: process.env.SDP_PREVIEW
      ? `npm run preview -- --port ${process.env.SDP_TEST_WEB_PORT || 5173} --strictPort`
      : `npm run dev -- --port ${process.env.SDP_TEST_WEB_PORT || 5173} --strictPort`,
    env: { SDP_BACKEND_PORT: backendPort },
    url: `http://127.0.0.1:${process.env.SDP_TEST_WEB_PORT || 5173}`,
    reuseExistingServer: !process.env.CI && !process.env.SDP_TEST_WEB_PORT,
    timeout: 30000,
  }],
});

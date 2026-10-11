import { expect, test, type Page } from '@playwright/test';
import { Client, type Room } from '@colyseus/sdk';
import { LOBBY_NAME } from '../shared/MultiplayerProtocol';
import { proximityGain } from '../src/audio/SpatialVoiceSettings';

test('proximity curve has full volume near, smooth attenuation and a hard hearing radius', () => {
  const settings = { fullDistance: 3, maxDistance: 15, smoothing: 0.06 };
  expect(proximityGain(0, settings)).toBe(1);
  expect(proximityGain(3, settings)).toBe(1);
  expect(proximityGain(9, settings)).toBe(0.5);
  expect(proximityGain(15, settings)).toBe(0);
  expect(proximityGain(40, settings)).toBe(0);
});

async function enter(page: Page, room?: string): Promise<void> {
  await page.goto(`/?multiplayerDebug=1${room ? `&room=${room}` : ''}`);
  await expect(page.locator('.connection-indicator')).toHaveAttribute('data-connection', 'connected');
  await expect(page.locator('.controls-overlay')).toHaveAttribute('data-voice-connection', 'connected');
  await page.getByRole('button', { name: 'CLICK TO ENTER' }).click();
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
}

async function focus(page: Page): Promise<void> {
  await page.bringToFront();
  if (await page.locator('.resume-button').isVisible()) await page.locator('.resume-button').click();
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
}

test.describe('secure local voice and shared chat', () => {
  test.skip(process.env.SDP_TEST_LAN !== '1', 'Run with SDP_TEST_LAN=1 and trusted local HTTPS / LiveKit.');

  test('two HTTPS browsers exchange room chat with authoritative senders and room isolation', async ({ browser }) => {
    const contexts = [await browser.newContext(), await browser.newContext(), await browser.newContext()];
    const client = new Client(`http://127.0.0.1:${process.env.SDP_TEST_SERVER_PORT || 2567}`);
    let primary: Room | undefined;
    let isolated: Room | undefined;
    try {
      const first = await contexts[0].newPage(); const second = await contexts[1].newPage(); const third = await contexts[2].newPage();
      primary = await client.create(LOBBY_NAME);
      await enter(first, primary.roomId); await enter(second, primary.roomId);
      await primary.leave(); primary = undefined;
      await expect.poll(() => first.evaluate(() => window.sdpMultiplayer.connection.status.online)).toBe(2);
      isolated = await client.create(LOBBY_NAME);
      await enter(third, isolated.roomId);
      expect(await first.evaluate(() => isSecureContext)).toBe(true);
      const firstRoom = await first.evaluate(() => window.sdpMultiplayer.connection.status.roomId);
      expect(await second.evaluate(() => window.sdpMultiplayer.connection.status.roomId)).toBe(firstRoom);
      expect(await third.evaluate(() => window.sdpMultiplayer.connection.status.roomId)).not.toBe(firstRoom);
      await focus(first);
      await first.keyboard.press('Enter');
      await first.getByRole('textbox', { name: 'Chat message' }).fill('   ');
      await first.keyboard.press('Enter');
      await expect(first.locator('.ui')).toHaveAttribute('data-state', 'CHATTING');
      await expect(second.locator('.chat-message')).toHaveCount(0);
      await first.getByRole('textbox', { name: 'Chat message' }).fill('Hola desde SDP <script>');
      await first.keyboard.press('Enter');
      await expect(first.locator('.chat-message')).toHaveText('YOU: Hola desde SDP <script>');
      await expect(second.locator('.chat-message')).toHaveText(/VISITOR \d+: Hola desde SDP <script>/);
      expect(await second.evaluate(() => window.sdpMultiplayer.chat.history[0].senderId)).toBe(await first.evaluate(() => window.sdpMultiplayer.connection.snapshot!.localPlayerId));
      await expect(third.locator('.chat-message')).toHaveCount(0);
      await first.keyboard.press('Enter'); await first.keyboard.press('Escape');
      await expect(first.locator('.chat-form')).toBeHidden();
      await second.evaluate(() => {
        const player = window.sdpMultiplayer.player;
        player.camera.position.x = 50;
      });
      await first.keyboard.press('Enter');
      await first.getByRole('textbox', { name: 'Chat message' }).fill('El texto llega a cualquier distancia');
      await first.keyboard.press('Enter');
      await expect(second.locator('.chat-message').last()).toContainText('El texto llega a cualquier distancia');
      const denied = await first.request.get('/@fs' + process.cwd() + '/.local/livekit-credentials.json');
      expect(denied.status()).toBe(403);
    } finally { await Promise.all(contexts.map((context) => context.close())); await primary?.leave(); await isolated?.leave(); }
  });

  test('real WebRTC receives microphone audio, gates PTT, pans in 3D, attenuates and isolates rooms', async ({ browser }, testInfo) => {
    test.setTimeout(90000);
    const contexts = [await browser.newContext(), await browser.newContext(), await browser.newContext()];
    const client = new Client(`http://127.0.0.1:${process.env.SDP_TEST_SERVER_PORT || 2567}`);
    let primary: Room | undefined;
    let isolated: Room | undefined;
    try {
      const first = await contexts[0].newPage(); const second = await contexts[1].newPage(); const third = await contexts[2].newPage();
      const sockets: string[] = [];
      for (const page of [first, second, third]) page.on('websocket', (socket) => sockets.push(socket.url().split('?')[0]));
      await first.addInitScript(() => {
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          const stream = await original(constraints);
          Object.assign(window, { testPTTStream: stream }); return stream;
        };
      });
      primary = await client.create(LOBBY_NAME);
      await enter(first, primary.roomId); await enter(second, primary.roomId);
      await primary.leave(); primary = undefined;
      await expect.poll(() => first.evaluate(() => window.sdpMultiplayer.connection.status.online)).toBe(2);
      isolated = await client.create(LOBBY_NAME);
      await enter(third, isolated.roomId);
      await focus(first);
      expect(sockets.filter((url) => url.includes('/multiplayer/') || url.includes('/voice/')).every((url) => url.startsWith('wss:'))).toBe(true);
      await first.keyboard.down('KeyV');
      await expect.poll(() => first.evaluate(() => window.sdpMultiplayer.voiceTransport.transmitting)).toBe(true);
      await expect.poll(() => second.evaluate(() => window.sdpMultiplayer.voiceTransport.remoteCount)).toBe(1);
      await expect.poll(() => second.evaluate(async () => (await window.sdpMultiplayer.voiceTransport.diagnostics()).remote[0]?.stats?.bytesReceived || 0)).toBeGreaterThan(0);
      expect(await first.evaluate(() => window.sdpMultiplayer.voiceTransport.remoteCount)).toBe(0);
      expect(await third.evaluate(() => window.sdpMultiplayer.voiceTransport.remoteCount)).toBe(0);

      await second.evaluate(() => {
        const transport = window.sdpMultiplayer.voiceTransport as unknown as {
          context: AudioContext; remotes: Map<string, { gain: GainNode; panner: PannerNode }>;
        };
        const remote = [...transport.remotes.values()][0];
        const splitter = transport.context.createChannelSplitter(2);
        const left = transport.context.createAnalyser(); const right = transport.context.createAnalyser();
        left.fftSize = 2048; right.fftSize = 2048;
        remote.gain.connect(splitter); splitter.connect(left, 0); splitter.connect(right, 1);
        Object.assign(window, { testSpatialMeters: { left, right } });
        const identity = [...transport.remotes.keys()][0];
        const source = window.sdpMultiplayer.connection.snapshot!.players.find((player) => player.playerId === identity)!;
        const camera = window.sdpMultiplayer.player.camera;
        camera.position.set(source.x - 2.5, source.y, source.z); camera.quaternion.identity();
      });
      async function meter() {
        return second.evaluate(() => {
          const meters = (window as unknown as { testSpatialMeters: { left: AnalyserNode; right: AnalyserNode } }).testSpatialMeters;
          return [meters.left, meters.right].map((meter) => {
            const samples = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(samples);
            return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
          });
        });
      }
      // Muted HTML elements are used only to feed Web Audio; measure the actual
      // decoded spatial output instead of Chromium's HTML-playout energy counter.
      await expect.poll(async () => Math.max(...await meter())).toBeGreaterThan(0.001);
      await expect.poll(async () => { const [left, right] = await meter(); return right / Math.max(0.000001, left); }).toBeGreaterThan(1.1);
      await second.evaluate(() => window.sdpMultiplayer.player.camera.rotation.y = Math.PI);
      await expect.poll(async () => { const [left, right] = await meter(); return left / Math.max(0.000001, right); }).toBeGreaterThan(1.1);
      await second.evaluate(() => window.sdpMultiplayer.player.camera.position.x -= 6.5);
      await expect.poll(() => second.evaluate(async () => (await window.sdpMultiplayer.voiceTransport.diagnostics()).remote[0]?.gain)).toBeCloseTo(0.5, 1);
      await second.evaluate(() => window.sdpMultiplayer.player.camera.position.x -= 9);
      await expect.poll(() => second.evaluate(async () => (await window.sdpMultiplayer.voiceTransport.diagnostics()).remote[0]?.gain)).toBeLessThan(0.0001);
      await expect.poll(async () => Math.max(...await meter())).toBeLessThan(0.0001);
      await first.screenshot({ path: testInfo.outputPath('lan-voice-desktop.png') });
      await first.keyboard.up('KeyV');
      await expect.poll(() => first.evaluate(() => window.sdpMultiplayer.voiceTransport.transmitting)).toBe(false);
      expect(await first.evaluate(() => (window as unknown as { testPTTStream: MediaStream }).testPTTStream.getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
      await expect.poll(() => first.evaluate(async () => (await window.sdpMultiplayer.voiceTransport.diagnostics()).localPublications)).toBe(0);
      await expect.poll(() => second.evaluate(() => window.sdpMultiplayer.voiceTransport.remoteCount)).toBe(0);
      await first.keyboard.press('Enter'); await first.keyboard.type('V en el texto');
      expect(await first.evaluate(() => window.sdpMultiplayer.voiceTransport.transmitting)).toBe(false);
      await first.keyboard.press('Escape');
      await focus(first);
      await first.keyboard.down('KeyV');
      await expect.poll(() => first.evaluate(() => window.sdpMultiplayer.voiceTransport.transmitting)).toBe(true);
      await first.evaluate(() => window.dispatchEvent(new Event('blur')));
      await expect.poll(() => first.evaluate(() => window.sdpMultiplayer.voiceTransport.transmitting)).toBe(false);
      await expect.poll(() => second.evaluate(() => window.sdpMultiplayer.voiceTransport.remoteCount)).toBe(0);
      await first.close();
      await expect.poll(() => second.evaluate(() => window.sdpMultiplayer.remotes.count)).toBe(0);
    } finally { await Promise.all(contexts.map((context) => context.close())); await primary?.leave(); await isolated?.leave(); }
  });
});

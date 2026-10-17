import { expect, test, type Page } from '@playwright/test';
import { enterExhibition } from './entry';
import type { LobbySnapshot } from '../shared/MultiplayerProtocol';

async function enter(page: Page, name = 'Preferences Tester'): Promise<void> {
  await page.goto('/?debugMode=limbo');
  await expect(page.locator('.ui')).toHaveAttribute('data-sculpture', 'loaded');
  await enterExhibition(page, name);
}

test('microphone ON/OFF latches until the next V and is force-muted by chat, focus loss and mode changes', async ({ page }) => {
  await enter(page); await page.keyboard.press('KeyP');
  const menu = page.getByRole('dialog', { name: 'Limbo settings' });
  await menu.getByText('ON / OFF', { exact: true }).click();
  await expect(menu.getByRole('radio', { name: 'Toggle microphone' })).toBeChecked();
  await page.keyboard.press('KeyP');
  await expect(page.locator('.voice-key')).toHaveText('V ON/OFF');
  await expect.poll(() => page.evaluate(() => window.sdpUnified.voiceTransport.state)).toBe('connected');
  await page.keyboard.press('KeyV');
  await expect.poll(() => page.evaluate(() => window.sdpUnified.voiceTransport.transmitting)).toBe(true);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.sdpUnified.voiceTransport.transmitting)).toBe(true);
  await page.keyboard.press('KeyV'); await expect.poll(() => page.evaluate(() => window.sdpUnified.voiceTransport.transmitting)).toBe(false);
  await page.keyboard.press('KeyV'); await expect.poll(() => page.evaluate(() => window.sdpUnified.voiceTransport.transmitting)).toBe(true);
  await page.keyboard.press('Enter'); await expect.poll(() => page.evaluate(() => window.sdpUnified.voiceTransport.transmitting)).toBe(false);
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyV'); await expect.poll(() => page.evaluate(() => window.sdpUnified.voiceTransport.transmitting)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => page.evaluate(() => window.sdpUnified.voiceTransport.transmitting)).toBe(false);
  await page.keyboard.press('KeyP'); await menu.getByText('HOLD', { exact: true }).click(); await page.keyboard.press('KeyP');
  await page.keyboard.down('KeyV'); await expect.poll(() => page.evaluate(() => window.sdpUnified.voiceTransport.transmitting)).toBe(true);
  await page.keyboard.up('KeyV'); await expect.poll(() => page.evaluate(() => window.sdpUnified.voiceTransport.transmitting)).toBe(false);
  await page.keyboard.press('KeyP'); await menu.getByText('ON / OFF', { exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('sdp:voiceMode'))).toBe('toggle');
  await page.reload(); await expect(page.locator('.ui')).toHaveAttribute('data-sculpture', 'loaded');
  await expect(page.locator('.voice-key')).toHaveText('V ON/OFF');
});

test('touch microphone ON/OFF reflects the real transmitting state after lifting the finger', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await enter(page); await page.getByRole('button', { name: 'Open game menu', exact: true }).tap();
    await page.getByRole('dialog', { name: 'Limbo settings' }).getByText('ON / OFF', { exact: true }).tap();
    await page.getByRole('button', { name: 'RETURN', exact: false }).tap();
    const mic = page.getByRole('button', { name: 'Toggle microphone', exact: true });
    await expect.poll(() => page.evaluate(() => window.sdpUnified.voiceTransport.state)).toBe('connected');
    await mic.tap(); await expect.poll(() => page.evaluate(() => window.sdpUnified.voiceTransport.transmitting)).toBe(true);
    await expect(mic).toHaveAttribute('aria-pressed', 'true');
    await mic.tap(); await expect.poll(() => page.evaluate(() => window.sdpUnified.voiceTransport.transmitting)).toBe(false);
    await expect(mic).toHaveAttribute('aria-pressed', 'false');
  } finally { await context.close(); }
});

test('nearby looked-at visitor name is server supplied, proximity limited and occluded by the monolith', async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext();
  const first = await a.newPage(), second = await b.newPage();
  try {
    await enter(first, 'Local Visitor'); await enter(second, 'Nearby Visitor');
    await first.bringToFront(); if (await first.locator('.resume-button').isVisible()) await first.locator('.resume-button').click();
    await expect.poll(() => first.evaluate(() => window.sdpUnified.scene.remotePlayers.count)).toBe(1);
    await first.evaluate(() => {
      const app = window.sdpUnified, snapshot = app.network.snapshot!;
      const other = snapshot.players.find(p => p.playerId !== snapshot.localPlayerId)!;
      app.player.setEnabled(false); app.scene.camera.position.set(other.x, other.y, other.z + 3); app.scene.camera.rotation.set(0, 0, 0);
    });
    await expect(first.locator('.visitor-focus')).toHaveText('Nearby Visitor'); await expect(first.locator('.visitor-focus')).toBeVisible();
    await first.evaluate(() => window.sdpUnified.scene.camera.rotation.y = .9);
    await expect(first.locator('.visitor-focus')).toBeHidden();
    await first.evaluate(() => { const c = window.sdpUnified.scene.camera; c.rotation.y = 0; c.position.z += 6; });
    await expect(first.locator('.visitor-focus')).toBeHidden();
    await first.evaluate(() => {
      const scene = window.sdpUnified.scene; scene.camera.position.z -= 6;
      scene.environment.occluders[1].position.set(scene.camera.position.x, 1, scene.camera.position.z - 1.5);
    });
    await expect(first.locator('.visitor-focus')).toBeHidden();
    await first.evaluate(() => window.sdpUnified.scene.environment.occluders[1].position.set(0, 0, 0));
    await expect(first.locator('.visitor-focus')).toBeVisible();
    await first.keyboard.press('KeyH'); await expect(first.locator('.visitor-focus')).toBeHidden(); await first.keyboard.press('KeyH');
    await expect(first.locator('.visitor-focus')).toBeVisible();
    await b.close(); await expect(first.locator('.visitor-focus')).toBeHidden();
  } finally { await a.close(); await b.close(); }
});

test('sky shading follows world elevation rather than a camera-centred screen stripe', async ({ page }) => {
  await enter(page);
  const colors = await page.evaluate(() => {
    const { scene } = window.sdpUnified, camera = scene.camera, renderer = scene.renderer;
    const visibility = scene.scene.children.map(object => [object, object.visible] as const);
    scene.scene.children.forEach(object => object.visible = object.renderOrder === -1000);
    const gl = renderer.getContext(); const samples: number[][] = [];
    for (const pitch of [0, .3]) {
      camera.rotation.set(pitch, 0, 0); camera.updateMatrixWorld(); scene.atmosphere.update(0, 1, camera);
      renderer.render(scene.scene, camera);
      const point = camera.position.clone().add(camera.position.clone().set(0, .2, -1).normalize().multiplyScalar(100)).project(camera);
      const pixel = new Uint8Array(4);
      gl.readPixels(Math.floor((point.x * .5 + .5) * gl.drawingBufferWidth), Math.floor((point.y * .5 + .5) * gl.drawingBufferHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      samples.push([...pixel]);
    }
    visibility.forEach(([object, visible]) => object.visible = visible);
    return samples;
  });
  expect(colors[0][3]).toBe(255); expect(colors[0][0]).toBeGreaterThan(30);
  for (let channel = 0; channel < 3; channel++) expect(Math.abs(colors[0][channel] - colors[1][channel])).toBeLessThanOrEqual(2);
});

test('music stays at original speed and does not seek when broadcast clock estimates drift', async ({ page }) => {
  const rate = 8000, seconds = 120, wav = Buffer.alloc(44 + rate * seconds);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(rate * seconds, 40);
  for (let i = 44; i < wav.length; i++) wav[i] = 128 + Math.round(16 * Math.sin(i * .2));
  await page.route('**/audio/playlist.json', route => route.fulfill({ json: [{ id: 'stable', title: 'Stable playback', artist: 'Fixture', url: '/audio/stable.wav', duration: seconds }] }));
  await page.route('**/audio/stable.wav', route => route.fulfill({ body: wav, contentType: 'audio/wav' }));
  await enter(page);
  await page.waitForFunction(() => { const audio = window.sdpUnified.audio as unknown as { media: HTMLAudioElement }; return !audio.media.paused && !audio.media.seeking && audio.media.readyState >= 3; });
  const result = await page.evaluate(() => {
    const audio = window.sdpUnified.audio as unknown as { media: HTMLAudioElement; sync(): void; receive(snapshot: LobbySnapshot): void };
    const before = audio.media.currentTime, rates: number[] = [], positions: number[] = [];
    for (const offset of [5, 30, 90, 12, 110]) {
      audio.receive({ wallTime: Date.UTC(2026, 0, 1) + offset * 1000, receivedAt: performance.now() } as LobbySnapshot);
      audio.sync(); rates.push(audio.media.playbackRate); positions.push(audio.media.currentTime);
    }
    return { before, rates, positions, preservesPitch: audio.media.preservesPitch };
  });
  expect(result.rates).toEqual([1, 1, 1, 1, 1]); expect(result.preservesPitch).toBe(true);
  for (const position of result.positions) expect(Math.abs(position - result.before)).toBeLessThan(.05);
});

test('compact preferences menu fits desktop and mobile with no overflowing labels or native oversized sliders', async ({ browser }) => {
  for (const [label, width, height, mobile] of [['desktop', 1440, 1000, false], ['mobile', 390, 844, true], ['landscape', 844, 390, true]] as const) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile }); const page = await context.newPage();
    try {
      await enter(page);
      if (mobile) await page.getByRole('button', { name: 'Open game menu', exact: true }).tap(); else await page.keyboard.press('KeyP');
      const menu = page.getByRole('dialog', { name: 'Limbo settings' }); await expect(menu).toBeVisible();
      expect(await menu.locator('.protocol-content').evaluate(element => element.scrollTop)).toBe(0);
      const heading = await menu.locator('.settings-heading').boundingBox(); expect(heading!.y).toBeGreaterThanOrEqual(10);
      const size = await menu.locator('.protocol-content').evaluate(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, overflow: element.scrollWidth - element.clientWidth }; });
      expect(size.x).toBeGreaterThanOrEqual(10); expect(size.y).toBeGreaterThanOrEqual(10); expect(size.right).toBeLessThanOrEqual(width - 10); expect(size.bottom).toBeLessThanOrEqual(height - 10); expect(size.overflow).toBeLessThanOrEqual(1);
      await expect(menu.getByRole('radio', { name: 'Hold to talk' })).toBeChecked();
      await page.screenshot({ path: `/private/tmp/sdp-preferences-${label}.png` });
      if (!mobile) {
        await page.keyboard.press('Tab'); await expect(menu.getByRole('slider', { name: 'Mouse sensitivity' })).toBeFocused();
        await page.keyboard.press('Shift+Tab'); await expect(menu.getByRole('button', { name: 'RETURN', exact: false })).toBeFocused();
      }
    } finally { await context.close(); }
  }
});

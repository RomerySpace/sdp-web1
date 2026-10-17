import { expect, test, type Page } from '@playwright/test';
import { enterExhibition } from './entry';
import type { LobbySnapshot } from '../shared/MultiplayerProtocol';
import type { VoiceChatManager } from '../src/audio/VoiceChatManager';
import { CollisionManager } from '../src/player/CollisionManager';
import { lobbyRetreat } from '../shared/LobbyRetreat';

async function approachBench(page: Page): Promise<void> {
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  await page.evaluate(config => {
    const app = window.sdpUnified, local = app.network.snapshot!.players.find(player => player.playerId === app.network.snapshot!.localPlayerId)!;
    const seat = config.seats[0], x = seat.x + Math.sin(seat.yaw) * 1.1, z = seat.z + Math.cos(seat.yaw) * 1.1;
    app.player.setSpawn({ ...local, yaw: Math.atan2(-(x - local.x), -(z - local.z)), pitch: 0 });
  }, lobbyRetreat);
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
  try {
    await expect.poll(() => page.evaluate(config => {
      const snapshot = window.sdpUnified.network.snapshot!, local = snapshot.players.find(player => player.playerId === snapshot.localPlayerId)!;
      return Math.hypot(local.x - config.seats[0].x, local.z - config.seats[0].z);
    }, lobbyRetreat), { timeout: 20000, intervals: [50] }).toBeLessThan(1.8);
  } finally { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); }
  await page.waitForTimeout(350); await aimAtBench(page);
}
async function aimAtBench(page: Page): Promise<void> {
  await page.evaluate(config => {
    const app = window.sdpUnified, local = app.network.snapshot!.players.find(player => player.playerId === app.network.snapshot!.localPlayerId)!;
    const seat = config.seats[0], dx = seat.x - local.x, dz = seat.z - local.z;
    app.player.setSpawn({ ...local, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(config.seatHeight - local.y, Math.hypot(dx, dz)) });
  }, lobbyRetreat);
  await expect(page.getByRole('button', { name: 'Sit on bench', exact: true })).toBeVisible();
}

test('E seats a visitor smoothly, keeps chat available and shows the seated pose to a second client', async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext();
  const first = await a.newPage(), second = await b.newPage();
  try {
    await enter(first, 'Seated Visitor'); await enter(second, 'Observer'); await first.bringToFront();
    if (await first.locator('.resume-button').isVisible()) await first.locator('.resume-button').click();
    await approachBench(first); await first.keyboard.press('KeyE');
    await expect.poll(() => first.evaluate(() => window.sdpUnified.player.seated)).toBe(true);
    await expect.poll(() => first.evaluate(() => Math.abs(window.sdpUnified.scene.camera.position.y - 1.18))).toBeLessThan(.03);
    await expect(first.getByRole('button', { name: 'Stand up', exact: true })).toBeVisible();
    await first.keyboard.press('Enter'); await first.getByRole('textbox', { name: 'Chat message' }).fill('Listening under the tree'); await first.keyboard.press('Enter');
    await expect(second.locator('.chat-message')).toContainText('Listening under the tree');
    expect(await first.evaluate(() => window.sdpUnified.player.seated)).toBe(true);
    await first.keyboard.press('KeyE'); await expect.poll(() => first.evaluate(() => window.sdpUnified.player.seated)).toBe(false);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.scene.camera.position.y)).toBeGreaterThan(1.6);
    await aimAtBench(first); await first.keyboard.press('KeyE'); await expect.poll(() => first.evaluate(() => window.sdpUnified.player.seated)).toBe(true);
    await second.bringToFront(); if (await second.locator('.resume-button').isVisible()) await second.locator('.resume-button').click();
    await second.evaluate(config => { const app = window.sdpUnified; app.player.setEnabled(false); app.scene.camera.position.set(config.seats[0].x + 3, 1.7, config.seats[0].z + 4); app.scene.camera.lookAt(config.seats[0].x, .9, config.seats[0].z); }, lobbyRetreat);
    await expect.poll(() => second.evaluate(() => {
      const app = window.sdpUnified, snapshot = app.network.snapshot!, other = snapshot.players.find(player => player.displayName === 'Seated Visitor')!;
      return other.seatIndex === 0 && app.scene.remotePlayers.group.getObjectByName(`Visitor:${other.playerId}`)?.getObjectByName('Seated legs')?.visible;
    })).toBe(true);
    await second.screenshot({ path: '/private/tmp/sdp-seated-visitor.png' });
    await first.bringToFront(); if (await first.locator('.resume-button').isVisible()) await first.locator('.resume-button').click();
    await first.keyboard.down('KeyW'); await expect.poll(() => first.evaluate(() => window.sdpUnified.player.seated)).toBe(false);
    const exit = await first.evaluate(() => window.sdpUnified.scene.camera.position.toArray());
    await expect.poll(() => first.evaluate(point => Math.hypot(window.sdpUnified.scene.camera.position.x - point[0], window.sdpUnified.scene.camera.position.z - point[2]), exit)).toBeGreaterThan(.3);
    await first.keyboard.up('KeyW');
  } finally { await a.close(); await b.close(); }
});

test('mobile visitors can tap to sit and stand or jump out of the bench', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), page = await context.newPage();
  try {
    await enter(page, 'Touch Seating'); await approachBench(page);
    await page.getByRole('button', { name: 'Sit on bench', exact: true }).tap();
    await expect.poll(() => page.evaluate(() => window.sdpUnified.player.seated)).toBe(true);
    await page.screenshot({ path: '/private/tmp/sdp-seated-mobile.png' });
    await page.getByRole('button', { name: 'Stand up', exact: true }).tap(); await expect.poll(() => page.evaluate(() => window.sdpUnified.player.seated)).toBe(false);
    await aimAtBench(page); await page.getByRole('button', { name: 'Sit on bench', exact: true }).tap(); await expect.poll(() => page.evaluate(() => window.sdpUnified.player.seated)).toBe(true);
    await page.getByRole('button', { name: 'Jump', exact: true }).tap(); await expect.poll(() => page.evaluate(() => window.sdpUnified.player.seated)).toBe(false);
  } finally { await context.close(); }
});

test('visitor options mute real remote voice, filter room messages and allow reversing a local block', async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext();
  const first = await a.newPage(), second = await b.newPage();
  try {
    await enter(first, 'Listener'); await enter(second, 'Nearby Artist');
    await first.bringToFront(); if (await first.locator('.resume-button').isVisible()) await first.locator('.resume-button').click();
    await expect.poll(() => first.evaluate(() => window.sdpUnified.scene.remotePlayers.count)).toBe(1);
    await first.evaluate(() => {
      const app = window.sdpUnified, snapshot = app.network.snapshot!;
      const other = snapshot.players.find(p => p.playerId !== snapshot.localPlayerId)!;
      app.player.setEnabled(false); app.scene.camera.position.set(other.x, other.y, other.z + 3); app.scene.camera.rotation.set(0, 0, 0);
    });
    await expect(first.locator('.visitor-focus')).toHaveText('Nearby Artist');
    await expect.poll(() => second.evaluate(() => window.sdpUnified.voiceTransport.state)).toBe('connected');
    await second.evaluate(async () => {
      window.sdpUnified.voiceTransport.unlock();
      await (window.sdpUnified as unknown as { voice: VoiceChatManager }).voice.press();
    });
    await expect.poll(() => first.evaluate(() => window.sdpUnified.voiceTransport.remoteCount)).toBe(1);
    await expect.poll(() => first.evaluate(async () => (await window.sdpUnified.voiceTransport.diagnostics()).remote[0]?.gain ?? 0)).toBeGreaterThan(.1);
    await first.keyboard.press('KeyE');
    const panel = first.getByRole('dialog', { name: 'Visitor options' }); await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Nearby Artist' })).toBeVisible();
    await panel.getByRole('checkbox', { name: 'Mute voice', exact: true }).check();
    await expect.poll(() => first.evaluate(async () => (await window.sdpUnified.voiceTransport.diagnostics()).remote[0]?.gain)).toBe(0);
    await panel.getByRole('checkbox', { name: 'Mute voice', exact: true }).uncheck();
    await expect.poll(() => first.evaluate(async () => (await window.sdpUnified.voiceTransport.diagnostics()).remote[0]?.gain ?? 0)).toBeGreaterThan(.1);
    await second.evaluate(() => window.sdpUnified.network.sendChat('Visible before filtering'));
    await expect(first.locator('.chat-message')).toContainText('Visible before filtering');
    await panel.getByRole('checkbox', { name: 'Hide messages', exact: true }).check();
    await expect(first.locator('.chat-message')).toHaveCount(0);
    await second.waitForTimeout(1100); await second.evaluate(() => window.sdpUnified.network.sendChat('Hidden for listener'));
    await second.waitForTimeout(300); await expect(first.locator('.chat-message')).toHaveCount(0);
    await expect(second.locator('.chat-message')).toHaveCount(2);
    await panel.getByRole('checkbox', { name: 'Hide messages', exact: true }).uncheck();
    await panel.getByRole('checkbox', { name: 'Block visitor', exact: true }).check();
    await expect(panel.getByRole('checkbox', { name: 'Mute voice', exact: true })).toBeDisabled();
    await expect.poll(() => first.evaluate(async () => (await window.sdpUnified.voiceTransport.diagnostics()).remote[0]?.gain)).toBe(0);
    await second.waitForTimeout(1100); await second.evaluate(() => window.sdpUnified.network.sendChat('Blocked message'));
    await second.waitForTimeout(300); await expect(first.locator('.chat-message')).toHaveCount(0);
    await first.keyboard.press('Escape'); await first.keyboard.press('KeyP');
    await first.getByRole('button', { name: 'VISITORS', exact: true }).click();
    await panel.getByRole('button', { name: 'Nearby Artist BLOCKED', exact: true }).click();
    await panel.getByRole('checkbox', { name: 'Block visitor', exact: true }).uncheck();
    await second.waitForTimeout(1100); await second.evaluate(() => window.sdpUnified.network.sendChat('Visible after unblock'));
    await expect(first.locator('.chat-message')).toHaveCount(1);
    await expect(first.locator('.chat-message')).toContainText('Visible after unblock');
    await expect.poll(() => first.evaluate(async () => (await window.sdpUnified.voiceTransport.diagnostics()).remote[0]?.gain ?? 0)).toBeGreaterThan(.1);
    await first.screenshot({ path: '/private/tmp/sdp-visitor-options.png' });
  } finally { await a.close(); await b.close(); }
});

test('listening tree renders on grass without a platform and preserves shared collisions', async ({ page }) => {
  const collision = new CollisionManager();
  for (const seat of lobbyRetreat.seats) {
    const c = Math.cos(seat.yaw), s = Math.sin(seat.yaw);
    const point = { x: seat.x + c * 3, z: seat.z - s * 3 };
    for (let i = 0; i < 50; i++) collision.move(point, -c * .1, s * .1);
    expect(Math.hypot(point.x - seat.x, point.z - seat.z)).toBeGreaterThan(lobbyRetreat.seatWidth / 2);
  }
  for (let i = 0; i < 25; i++) {
    const yaw = i * Math.PI * 2 / 25, point = { x: Math.sin(yaw) * 9, z: Math.cos(yaw) * 9 }, before = { ...point };
    collision.move(point, .001, .001); expect(point.x).toBeCloseTo(before.x + .001, 6); expect(point.z).toBeCloseTo(before.z + .001, 6);
  }
  await enter(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(config => {
    const app = window.sdpUnified; app.player.setEnabled(false);
    app.scene.camera.position.set(config.x + 12, 4.5, config.z + 17); app.scene.camera.lookAt(config.x, 3.8, config.z);
  }, lobbyRetreat);
  await expect.poll(() => page.evaluate(() => window.sdpUnified.scene.environment.retreat.seats.length)).toBe(3);
  await expect.poll(() => page.evaluate(() => window.sdpUnified.scene.environment.retreat.treeLoaded)).toBe(true);
  const details = await page.evaluate(() => {
    const retreat = window.sdpUnified.scene.environment.retreat;
    return { children: retreat.group.children.length, treeMeshes: retreat.tree.getObjectsByProperty('type', 'Mesh').length, error: retreat.tree.userData.error };
  });
  expect(details.children).toBe(4); expect(details.treeMeshes).toBeGreaterThan(0); expect(details.error).toBeUndefined();
  await page.waitForTimeout(500); await page.screenshot({ path: '/private/tmp/sdp-listening-clearing.png' });
  const pixels = await page.evaluate(() => {
    const { renderer, scene, camera } = window.sdpUnified.scene; renderer.render(scene, camera);
    const gl = renderer.getContext(), pixel = new Uint8Array(4); const samples: number[] = [];
    for (let x = .25; x <= .75; x += .1) { gl.readPixels(Math.floor(gl.drawingBufferWidth * x), Math.floor(gl.drawingBufferHeight * .45), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); samples.push(pixel[0]); }
    return samples;
  });
  expect(Math.max(...pixels) - Math.min(...pixels)).toBeGreaterThan(5); expect(errors).toEqual([]);
});

test('touch visitor name opens reversible options and the listening clearing fits a mobile viewport', async ({ browser }) => {
  const a = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), b = await browser.newContext();
  const first = await a.newPage(), second = await b.newPage();
  try {
    await enter(first, 'Touch Visitor'); await enter(second, 'Other Visitor'); await first.bringToFront();
    await expect.poll(() => first.evaluate(() => window.sdpUnified.scene.remotePlayers.count)).toBe(1);
    await first.evaluate(() => {
      const app = window.sdpUnified, snapshot = app.network.snapshot!, other = snapshot.players.find(p => p.playerId !== snapshot.localPlayerId)!;
      app.player.setEnabled(false); app.scene.camera.position.set(other.x, other.y, other.z + 3); app.scene.camera.rotation.set(0, 0, 0);
    });
    await expect(first.locator('.visitor-focus')).toHaveText('Other Visitor'); await first.locator('.visitor-focus').tap();
    const panel = first.getByRole('dialog', { name: 'Visitor options' }); await expect(panel).toBeVisible();
    await panel.getByRole('checkbox', { name: 'Block visitor', exact: true }).check();
    await expect(first.getByRole('button', { name: 'Open game menu', exact: true })).toBeHidden();
    await first.screenshot({ path: '/private/tmp/sdp-visitor-options-mobile.png' });
    await panel.getByRole('button', { name: 'Close visitor options' }).tap();
    await first.getByRole('button', { name: 'Open game menu', exact: true }).tap();
    await first.getByRole('button', { name: 'VISITORS', exact: true }).tap();
    await panel.getByRole('button', { name: 'Other Visitor BLOCKED', exact: true }).tap();
    await panel.getByRole('checkbox', { name: 'Block visitor', exact: true }).uncheck();
    await b.close(); await expect(panel.locator('.visitor-status')).toHaveText('OFFLINE');
    await panel.getByRole('button', { name: 'Close visitor options' }).tap();
    await expect.poll(() => first.evaluate(() => window.sdpUnified.scene.environment.retreat.treeLoaded)).toBe(true);
    await first.evaluate(config => { const app = window.sdpUnified; app.player.setEnabled(false); app.scene.camera.position.set(config.x + 17, 6, config.z + 26); app.scene.camera.lookAt(config.x, 3.8, config.z); }, lobbyRetreat);
    await first.waitForTimeout(300); await first.screenshot({ path: '/private/tmp/sdp-listening-clearing-mobile.png' });
    const result = await first.evaluate(() => {
      const { renderer, scene, camera, environment } = window.sdpUnified.scene; renderer.render(scene, camera);
      const visible = environment.retreat.seats.map(seat => seat.position.clone().project(camera)).every(p => Math.abs(p.x) < 1 && Math.abs(p.y) < 1);
      const gl = renderer.getContext(), pixel = new Uint8Array(4); gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return { visible, pixel: [...pixel], width: document.documentElement.scrollWidth };
    });
    expect(result.visible).toBe(true); expect(result.pixel[3]).toBe(255); expect(result.pixel[0]).toBeGreaterThan(10); expect(result.width).toBe(390);
  } finally { await a.close(); await b.close(); }
});

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
  const credit = page.getByLabel('Now playing');
  await expect(credit).toBeVisible();
  await page.evaluate(() => {
    const audio = window.sdpUnified.audio as unknown as { media: HTMLAudioElement };
    audio.media.dispatchEvent(new Event('waiting'));
  });
  await expect(credit).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('KeyH'); await expect(credit).toBeHidden();
    await page.waitForTimeout(1700);
    await page.keyboard.press('KeyH'); await expect(credit).toBeVisible();
    await expect(credit.locator('.music-title')).toBeVisible();
  }
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

test('classic preferences menu fits desktop and mobile without redundant HUD hints', async ({ browser }) => {
  for (const [label, width, height, mobile] of [['desktop', 1440, 1000, false], ['mobile', 390, 844, true], ['landscape', 844, 390, true]] as const) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile }); const page = await context.newPage();
    try {
      await enter(page);
      if (mobile) await page.getByRole('button', { name: 'Open game menu', exact: true }).tap(); else await page.keyboard.press('KeyP');
      const menu = page.getByRole('dialog', { name: 'Limbo settings' }); await expect(menu).toBeVisible();
      expect(await menu.locator('.protocol-content').evaluate(element => element.scrollTop)).toBe(0);
      const heading = await menu.locator('.protocol-mark').boundingBox(); expect(heading!.y).toBeGreaterThanOrEqual(10);
      await expect(menu.getByRole('checkbox', { name: 'Hide HUD' })).toHaveCount(0);
      await expect(menu.getByText('P MENU / H HUD', { exact: true })).toHaveCount(0);
      const sliders = await menu.getByRole('slider').evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width }; }));
      expect(sliders).toHaveLength(3);
      for (let i = 1; i < sliders.length; i++) { expect(sliders[i].x).toBe(sliders[0].x); expect(sliders[i].width).toBe(sliders[0].width); expect(sliders[i].y).toBeGreaterThan(sliders[i - 1].y); }
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

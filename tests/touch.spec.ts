import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { enterExhibition } from './entry';
import { touchDriver, walkToSculpture } from './touch-driver';
import type { ColyseusNetworkAdapter } from '../src/network/ColyseusNetworkAdapter';
import type { GameModeManager } from '../src/modes/GameModeManager';
import type { FirstPersonController } from '../src/player/FirstPersonController';
type Debug = { modes: GameModeManager; network: ColyseusNetworkAdapter; player: FirstPersonController };
const debug = (page: Page) => page.evaluate(() => (window as unknown as { sdpUnified: Debug }).sdpUnified.network.status);
const own = (page: Page) => page.evaluate(() => { const s = (window as unknown as { sdpUnified: Debug }).sdpUnified.network.snapshot!; return s.players.find(p => p.playerId === s.localPlayerId)!; });
async function open(page: Page, name: string) { await page.goto('/?debugMode=limbo'); await enterExhibition(page, name); await expect(page.locator('#app')).toHaveAttribute('data-input', 'touch'); }
async function shooter(page: Page, name = 'Touch Shooter') {
  await open(page, name); await walkToSculpture(page);
  await page.getByRole('button', { name: 'JOIN SHOOTER' }).tap();
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'SHOOTER');
  await page.getByRole('button', { name: 'ENTER SIMULATION' }).tap();
  await expect(page.locator('.touch-controls')).toHaveAttribute('data-context', 'shooter');
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
}
async function visibleCanvas(page: Page) {
  const { data, info } = await sharp(await page.locator('canvas').screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0; for (let i = 0; i < data.length; i += info.channels) if (Math.min(data[i], data[i + 1], data[i + 2]) < 210) count++;
  return count;
}
async function hudFits(page: Page) {
  const bounds = await page.locator('.touch-button, .touch-stick').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).map(n => {
    const r = n.getBoundingClientRect(); return { name: n.getAttribute('aria-label'), x: r.x, y: r.y, width: r.width, height: r.height };
  }));
  const size = page.viewportSize()!;
  for (const b of bounds) { expect(b.x, b.name!).toBeGreaterThanOrEqual(0); expect(b.y, b.name!).toBeGreaterThanOrEqual(0); expect(b.x + b.width, b.name!).toBeLessThanOrEqual(size.width); expect(b.y + b.height, b.name!).toBeLessThanOrEqual(size.height); expect(b.width).toBeGreaterThanOrEqual(44); }
  for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
    const a = bounds[i], b = bounds[j]; expect(Math.max(0, Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)) * Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)), `${a.name} / ${b.name}`).toBe(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
}
test('mobile Limbo: real multi-touch analog movement/look synchronizes with desktop and chat/menu stop input', async ({ browser }, info) => {
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const desktop = await browser.newContext();
  try {
    const page = await mobile.newPage(), peer = await desktop.newPage(); await open(page, 'Touch Visitor');
    await peer.goto('/?debugMode=limbo'); await enterExhibition(peer, 'Desktop Peer');
    await page.bringToFront(); expect((await debug(page)).roomId).toBe((await debug(peer)).roomId);
    const before = await own(page), pad = (await page.locator('.touch-stick').boundingBox())!, driver = await touchDriver(page);
    const x = pad.x + pad.width / 2, y = pad.y + pad.height / 2;
    await driver.down(1, x, y); await driver.move(1, x, y - pad.width * .19);
    await expect.poll(() => page.evaluate(() => (window as unknown as { sdpUnified: Debug }).sdpUnified.player.input.forward)).toBeGreaterThan(.45);
    await page.waitForTimeout(1000); const moved = await own(page); expect(Math.hypot(moved.x-before.x,moved.z-before.z)).toBeGreaterThan(.8); expect(Math.hypot(moved.x-before.x,moved.z-before.z)).toBeLessThan(2);
    const yaw = await page.evaluate(() => (window as unknown as { sdpUnified: Debug }).sdpUnified.player.camera.rotation.y);
    await driver.down(2, 270, 300); await driver.move(2, 310, 310);
    await expect.poll(() => page.evaluate(() => (window as unknown as { sdpUnified: Debug }).sdpUnified.player.camera.rotation.y)).toBeLessThan(yaw - .05);
    await driver.up(2); await driver.up(1);
    await expect.poll(() => peer.evaluate(id => { const s = (window as unknown as { sdpUnified: Debug }).sdpUnified.network.snapshot!; return s.players.find(p => p.playerId === id)?.z; }, moved.playerId)).toBeLessThan(before.z - .8);
    await page.getByRole('button', { name: 'Sprint', exact: true }).tap(); await expect(page.getByRole('button', { name: 'Sprint', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await driver.down(1, x, y); await driver.move(1, x, y - pad.width * .4);
    await page.getByRole('button', { name: 'Open game menu' }).tap();
    await expect(page.getByRole('dialog', { name: 'Limbo settings' })).toBeVisible(); await driver.cancel();
    expect(await page.evaluate(() => (window as unknown as { sdpUnified: Debug }).sdpUnified.player.input.forward)).toBe(0);
    await page.getByRole('slider', { name: 'Look sensitivity' }).press('End');
    await page.getByRole('button', { name: 'RETURN P', exact: true }).tap();
    await page.getByRole('button', { name: 'Open chat' }).tap(); await page.getByRole('textbox', { name: 'Chat message' }).fill('Touch room message');
    await page.getByRole('button', { name: 'Send message' }).tap(); await expect(peer.locator('.chat-message')).toContainText('Touch room message');
    await expect(page.locator('.touch-stick')).toBeVisible();
    await page.getByRole('button', { name: 'Open chat' }).tap(); await page.getByRole('button', { name: 'Close chat' }).tap();
    await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
    await hudFits(page); await page.screenshot({ path: info.outputPath('touch-limbo-portrait.png') });
    await expect(peer.locator('.touch-controls')).toHaveCount(0);
  } finally { await mobile.close(); await desktop.close(); }
});
test('mobile Shooter: real simultaneous movement/look/fire, ADS, crouch, jump, reload, cancellation and returning', async ({ browser }, info) => {
  const a = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), b = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  try {
    const page = await a.newPage(), peer = await b.newPage(), errors: string[] = [], requests: string[] = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
    await open(page, 'Touch Alpha'); await walkToSculpture(page); expect(requests.filter(u => /\/shooter\/|ShooterMode-|shooter-physics-|rapier3d/.test(u))).toEqual([]);
    await page.getByRole('button', { name: 'JOIN SHOOTER' }).tap(); await expect(page.locator('#app')).toHaveAttribute('data-mode', 'SHOOTER'); await page.getByRole('button', { name: 'ENTER SIMULATION' }).tap();
    await shooter(peer, 'Touch Beta'); await page.bringToFront();
    if (await page.getByRole('button', { name: 'RESUME', exact: true }).isVisible()) await page.getByRole('button', { name: 'RESUME', exact: true }).tap();
    expect((await debug(page)).roomId).toBe((await debug(peer)).roomId);
    await expect.poll(async () => (await own(page)).grounded).toBe(true);
    const floor = (await own(page)).y;
    await page.getByRole('button', { name: 'Jump', exact: true }).tap();
    await expect.poll(async () => (await own(page)).y).toBeGreaterThan(floor + .2);
    await expect.poll(async () => (await own(page)).grounded).toBe(true);
    await page.getByRole('button', { name: 'Aim down sights' }).tap(); await expect.poll(() => page.evaluate(() => (window as unknown as { sdpUnified: Debug }).sdpUnified.modes.shooter!.weapon.ads)).toBeGreaterThan(.6); await page.getByRole('button', { name: 'Aim down sights' }).tap();
    await page.getByRole('button', { name: 'Switch fire mode' }).tap(); await expect.poll(async () => (await own(page)).automatic).toBe(true);
    const driver = await touchDriver(page), pad = (await page.locator('.touch-stick').boundingBox())!, fire = (await page.getByRole('button', { name: 'Fire weapon' }).boundingBox())!;
    const x = pad.x + pad.width / 2, y = pad.y + pad.height / 2, fx = fire.x + fire.width / 2, fy = fire.y + fire.height / 2;
    const initialYaw = await page.evaluate(() => (window as unknown as { sdpUnified: Debug }).sdpUnified.modes.shooter!.input.yaw);
    await driver.down(1, x, y); await driver.move(1, x + pad.width * .3, y);
    await driver.down(2, fx, fy); await driver.move(2, fx + 32, fy - 8);
    await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 0 })));
    expect(await page.evaluate(() => (window as unknown as { sdpUnified: Debug }).sdpUnified.modes.shooter!.input.trigger)).toBe(true);
    await page.waitForTimeout(650);
    expect((await own(page)).ammo).toBeLessThanOrEqual(26);
    expect(await page.evaluate(() => (window as unknown as { sdpUnified: Debug }).sdpUnified.modes.shooter!.input.sideways)).toBeGreaterThan(.5);
    expect(Math.abs(await page.evaluate(() => (window as unknown as { sdpUnified: Debug }).sdpUnified.modes.shooter!.input.yaw) - initialYaw)).toBeGreaterThan(.05);
    await driver.up(2); await driver.up(1); await page.waitForTimeout(200); const ammo = (await own(page)).ammo; await page.waitForTimeout(350); expect((await own(page)).ammo).toBe(ammo);
    await page.getByRole('button', { name: 'Crouch', exact: true }).tap(); await expect.poll(async () => (await own(page)).height).toBeLessThan(1.3);
    await expect.poll(() => peer.evaluate(() => (window as unknown as { sdpUnified: Debug }).sdpUnified.modes.shooter!.remotes.group.children[0].userData.height)).toBeLessThan(1.3);
    await page.getByRole('button', { name: 'Crouch', exact: true }).tap(); await expect.poll(async () => (await own(page)).height).toBeGreaterThan(1.7);
    await page.getByRole('button', { name: 'Reload weapon' }).tap(); await expect.poll(async () => (await own(page)).reloading).toBe(true); await expect.poll(async () => (await own(page)).ammo).toBe(30);
    await driver.down(1, x, y); await driver.move(1, x, y - pad.width * .4); await driver.down(2, fx, fy); await page.waitForTimeout(150); await driver.cancel();
    expect(await page.evaluate(() => (window as unknown as { sdpUnified: Debug }).sdpUnified.modes.shooter!.input.trigger)).toBe(false);
    expect(await page.evaluate(() => (window as unknown as { sdpUnified: Debug }).sdpUnified.modes.shooter!.input.forward)).toBe(0);
    for (const [width, height] of [[390,844],[844,390],[667,375],[320,568],[1024,768]]) {
      await page.setViewportSize({ width, height }); await hudFits(page); expect(await visibleCanvas(page)).toBeGreaterThan(1000); await page.screenshot({ path: info.outputPath(`touch-shooter-${width}x${height}.png`) });
    }
    await page.getByRole('button', { name: 'Open game menu' }).tap(); await expect(page.getByRole('table', { name: 'Room scores' })).toBeVisible(); await page.getByRole('button', { name: 'RETURN TO LIMBO' }).tap();
    await expect(page.locator('#app')).toHaveAttribute('data-mode', 'LIMBO'); await expect(page.locator('.touch-stick')).toBeVisible(); await expect(page.locator('canvas')).toHaveCount(1); expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); }
});
test('touch microphone capture stops on release, cancellation and focus loss', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['microphone'] });
  try {
    await context.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      Object.assign(window, { touchMicTracks: [] });
      navigator.mediaDevices.getUserMedia = async c => { const stream = await original(c); (window as unknown as { touchMicTracks: MediaStreamTrack[] }).touchMicTracks.push(...stream.getAudioTracks()); return stream; };
    });
    const page = await context.newPage(); await open(page, 'Touch Voice');
    const driver = await touchDriver(page), box = (await page.getByRole('button', { name: 'Hold to talk' }).boundingBox())!;
    await driver.down(1, box.x + 22, box.y + 22); await expect(page.locator('.touch-controls')).toHaveAttribute('data-voice', 'speaking'); await driver.up(1);
    await expect.poll(() => page.evaluate(() => (window as unknown as { touchMicTracks: MediaStreamTrack[] }).touchMicTracks.every(t => !t.enabled || t.readyState === 'ended'))).toBe(true);
    await driver.down(1, box.x + 22, box.y + 22); await expect(page.locator('.touch-controls')).toHaveAttribute('data-voice', 'speaking'); await driver.cancel();
    await expect(page.locator('.touch-controls')).not.toHaveAttribute('data-voice', 'speaking');
    await driver.down(1, box.x + 22, box.y + 22); await expect(page.locator('.touch-controls')).toHaveAttribute('data-voice', 'speaking'); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await driver.cancel();
    await expect(page.locator('.ui')).toHaveAttribute('data-state', 'PAUSED'); await expect.poll(() => page.evaluate(() => (window as unknown as { touchMicTracks: MediaStreamTrack[] }).touchMicTracks.every(t => !t.enabled || t.readyState === 'ended'))).toBe(true);
  } finally { await context.close(); }
});

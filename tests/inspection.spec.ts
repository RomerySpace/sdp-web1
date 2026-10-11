import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import type { FirstPersonController } from '../src/player/FirstPersonController';
import type { Sculpture } from '../src/scene/Sculpture';
import type { SculptureInspection } from '../src/scene/SculptureInspection';
import type { ExperienceStateMachine } from '../src/core/ExperienceState';
import { SCULPTURE_HEIGHT, SCULPTURE_ROUGHNESS } from '../src/scene/Sculpture';

declare global {
  interface Window {
    sdpInspection: { sculpture: Sculpture; inspection: SculptureInspection; player: FirstPersonController; state: ExperienceStateMachine };
  }
}

async function enter(page: Page): Promise<void> {
  await page.goto('/?inspectionDebug=1&multiplayerDebug=1');
  await expect(page.locator('.ui')).toHaveAttribute('data-sculpture', 'loaded');
  await expect(page.locator('.connection-indicator')).toHaveAttribute('data-connection', 'connected');
  await page.getByRole('button', { name: 'CLICK TO ENTER' }).click();
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
}

test('SDPv1 loads in matte black, rotates, and inspection preserves the player', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await enter(page);
  const model = await page.evaluate(() => {
    const root = window.sdpInspection.sculpture.root;
    const materials: { color: number; metalness: number; roughness: number; map: boolean }[] = [];
    let vertices = 0;
    root.traverse((object) => {
      const mesh = object as unknown as { isMesh?: boolean; geometry: { attributes: { position: { count: number } } }; material: { color: { getHex(): number }; metalness: number; roughness: number; map: unknown } };
      if (!mesh.isMesh) return;
      vertices += mesh.geometry.attributes.position.count;
      materials.push({ color: mesh.material.color.getHex(), metalness: mesh.material.metalness, roughness: mesh.material.roughness, map: !!mesh.material.map });
    });
    return { vertices, materials, rotation: root.rotation.y };
  });
  expect(model.vertices).toBe(429040);
  expect(model.materials).toEqual([{ color: 0x080808, metalness: 0, roughness: SCULPTURE_ROUGHNESS, map: false }]);
  const worldSize = await page.evaluate(async (moduleURL) => {
    const { Box3, Vector3 } = await import(moduleURL);
    return new Box3().setFromObject(window.sdpInspection.sculpture.root).getSize(new Vector3()).toArray();
  }, '/node_modules/three/build/three.module.js');
  expect(worldSize[1]).toBeCloseTo(SCULPTURE_HEIGHT, 4);
  expect(Math.max(worldSize[0], worldSize[2])).toBeLessThan(2.2);
  await expect.poll(() => page.evaluate(() => window.sdpInspection.sculpture.root.rotation.y)).not.toBe(model.rotation);
  await page.screenshot({ path: testInfo.outputPath('SDPv1-exhibition.png') });
  await page.keyboard.press('KeyE');
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  await expect(page.getByRole('button', { name: 'Inspect sculpture', exact: true })).toBeHidden();
  await page.evaluate(() => window.sdpInspection.player.camera.position.set(0, 1.7, 3));
  await expect(page.getByRole('button', { name: 'Inspect sculpture', exact: true })).toBeVisible();
  await expect(page.locator('.inspect-button kbd')).toHaveText('E');
  await expect(page.locator('.inspect-button kbd')).toBeVisible();
  await expect(page.locator('.inspect-button')).toContainText('INSPECT');
  const original = await page.evaluate(() => ({ position: window.sdpInspection.player.camera.position.toArray(), rotation: window.sdpInspection.player.camera.rotation.toArray() }));
  await page.keyboard.press('KeyE');
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'INSPECTING');
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  await expect(page.locator('.inspection-close kbd')).toHaveText('E');
  const idle = await page.evaluate(() => ({
    angle: window.sdpInspection.inspection.scene.getObjectByName('inspection-sculpture')!.rotation.y,
    camera: window.sdpInspection.inspection.camera.position.toArray(),
  }));
  const firstFrame = await sharp(await page.locator('canvas').screenshot()).removeAlpha().raw().toBuffer();
  await expect.poll(() => page.evaluate((idle) => window.sdpInspection.inspection.scene.getObjectByName('inspection-sculpture')!.rotation.y - idle.angle, idle)).toBeGreaterThan(0.04);
  expect(await page.evaluate(() => window.sdpInspection.inspection.camera.position.toArray())).toEqual(idle.camera);
  const secondFrame = await sharp(await page.locator('canvas').screenshot()).removeAlpha().raw().toBuffer();
  let changed = 0;
  const tones = new Set<number>();
  for (let index = 0; index < secondFrame.length; index += 3) {
    if (Math.abs(firstFrame[index] - secondFrame[index]) > 5) changed++;
    if (secondFrame[index] < 140) tones.add(Math.floor(secondFrame[index] / 4));
  }
  expect(changed).toBeGreaterThan(100);
  expect(tones.size).toBeGreaterThan(12);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  expect(await page.evaluate(() => window.sdpInspection.player.camera.position.toArray())).toEqual(original.position);
  await page.screenshot({ path: testInfo.outputPath('inspection-desktop.png') });
  const initialDistance = await page.evaluate(() => window.sdpInspection.inspection.distance);
  const before = await page.evaluate(() => window.sdpInspection.inspection.camera.position.toArray());
  await page.mouse.move(690, 470);
  await page.mouse.down();
  await page.mouse.move(920, 550, { steps: 15 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.sdpInspection.inspection.camera.position.toArray())).not.toEqual(before);
  await page.mouse.wheel(0, -20000);
  await expect.poll(() => page.evaluate(() => {
    const inspection = window.sdpInspection.inspection;
    return Math.abs(inspection.distance - inspection.controls.minDistance);
  })).toBeLessThan(0.01);
  const closestDistance = await page.evaluate(() => window.sdpInspection.inspection.distance);
  expect(closestDistance).toBeLessThan(initialDistance * 0.4);
  await page.screenshot({ path: testInfo.outputPath('inspection-close-up.png') });
  await page.mouse.wheel(0, 20000);
  await expect.poll(() => page.evaluate(() => {
    const inspection = window.sdpInspection.inspection;
    return Math.abs(inspection.distance - inspection.controls.maxDistance);
  })).toBeLessThan(0.01);
  await page.keyboard.press('KeyE');
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
  expect(await page.evaluate(() => window.sdpInspection.player.camera.position.toArray())).toEqual(original.position);
  expect(await page.evaluate(() => window.sdpInspection.player.camera.rotation.toArray())).toEqual(original.rotation);
  expect(await page.evaluate(() => window.sdpInspection.inspection.active)).toBe(false);
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Chat message' }).fill('e remains text while chatting');
  await page.keyboard.press('KeyE');
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'CHATTING');
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyE');
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'INSPECTING');
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'PAUSED');
  expect(await page.evaluate(() => window.sdpInspection.inspection.active)).toBe(false);
  await expect(page.locator('.inspect-button')).toBeVisible();
  await page.keyboard.press('KeyE');
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'INSPECTING');
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  expect(errors).toEqual([]);
});

test('touch inspection is framed, nonblank and closes without pointer lock', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const page = await context.newPage();
    await page.goto('/?inspectionDebug=1');
    await expect(page.locator('.ui')).toHaveAttribute('data-sculpture', 'loaded');
    await page.getByRole('button', { name: 'VIEW EXHIBITION' }).click();
    await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
    await expect(page.locator('.inspect-button kbd')).toBeHidden();
    await page.getByRole('button', { name: 'Inspect sculpture', exact: true }).click();
    await expect(page.locator('.ui')).toHaveAttribute('data-state', 'INSPECTING');
    const { data: pixels, info } = await sharp(await page.locator('canvas').screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let dark = 0;
    let minX = info.width, maxX = 0;
    for (let index = 0; index < pixels.length; index += 3) if (pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100) {
      dark++;
      const x = (index / 3) % info.width;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    }
    expect(dark).toBeGreaterThan(1500);
    expect(minX).toBeGreaterThan(5);
    expect(maxX).toBeLessThan(info.width - 5);
    await page.screenshot({ path: testInfo.outputPath('inspection-mobile.png') });
    const close = await page.getByRole('button', { name: 'Close inspection' }).boundingBox();
    expect(close!.x + close!.width).toBeLessThanOrEqual(390);
    await page.getByRole('button', { name: 'Close inspection' }).click();
    await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
    expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  } finally { await context.close(); }
});

test('a missing model disables inspection without breaking the exhibition', async ({ page }) => {
  await page.route('**/SDPv1.glb', (route) => route.abort());
  await page.goto('/?inspectionDebug=1');
  await expect(page.locator('.ui')).toHaveAttribute('data-sculpture', 'fallback');
  await page.getByRole('button', { name: 'CLICK TO ENTER' }).click();
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  await page.evaluate(() => window.sdpInspection.player.camera.position.set(0, 1.7, 3));
  await page.keyboard.press('KeyE');
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  await expect(page.getByRole('button', { name: 'Inspect sculpture', exact: true })).toBeHidden();
});

test('inspection keeps push-to-talk functional without moving the network player', async ({ browser }) => {
  test.skip(process.env.SDP_TEST_LAN !== '1', 'Requires the trusted local HTTPS and LiveKit test services.');
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  try {
    const first = await firstContext.newPage();
    const second = await secondContext.newPage();
    await enter(first);
    await enter(second);
    for (const page of [first, second]) await expect(page.locator('.controls-overlay')).toHaveAttribute('data-voice-connection', 'connected');
    await first.bringToFront();
    if (await first.locator('.resume-button').isVisible()) await first.locator('.resume-button').click();
    await first.waitForFunction(() => !!document.pointerLockElement && document.hasFocus());
    await first.evaluate(() => window.sdpInspection.player.camera.position.set(0, 1.7, 3));
    const identity = await first.evaluate(() => window.sdpMultiplayer.connection.snapshot!.localPlayerId);
    await first.keyboard.press('KeyE');
    await expect(first.locator('.ui')).toHaveAttribute('data-state', 'INSPECTING');
    await first.waitForTimeout(300);
    const position = await first.evaluate((identity) => {
      const player = window.sdpMultiplayer.connection.snapshot!.players.find((player) => player.playerId === identity)!;
      return [player.x, player.y, player.z, player.yaw];
    }, identity);
    await first.keyboard.down('KeyV');
    await expect(first.locator('.controls-overlay')).toHaveAttribute('data-voice', 'speaking');
    await expect.poll(() => second.evaluate(async (identity) => (await window.sdpMultiplayer.voiceTransport.diagnostics()).remote.find((remote) => remote.identity === identity)?.stats?.bytesReceived || 0, identity)).toBeGreaterThan(0);
    await first.mouse.move(650, 420);
    await first.mouse.down();
    await first.mouse.move(900, 520, { steps: 12 });
    await first.mouse.up();
    expect(await first.evaluate((identity) => {
      const player = window.sdpMultiplayer.connection.snapshot!.players.find((player) => player.playerId === identity)!;
      return [player.x, player.y, player.z, player.yaw];
    }, identity)).toEqual(position);
    await first.keyboard.up('KeyV');
    await expect(first.locator('.controls-overlay')).toHaveAttribute('data-voice', 'ready');
    await expect.poll(() => first.evaluate(() => window.sdpMultiplayer.voiceTransport.transmitting)).toBe(false);
    await first.keyboard.press('KeyE');
    await expect(first.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  } finally { await firstContext.close(); await secondContext.close(); }
});

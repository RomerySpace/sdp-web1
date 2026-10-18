import { test, expect, type Page } from '@playwright/test';
import { enterExhibition } from './entry';
import { ambientStation } from '../shared/AmbientStation';
import type { Mesh } from 'three';

test('instrument supports join the underframe and tabletop without floating gaps', async ({ page }) => {
  await enter(page, 'Structure Check');
  const joints = await page.evaluate(() => {
    const group = window.sdpUnified.scene.scene.getObjectByName('Limbo / ambient instrument')!;
    group.updateMatrixWorld(true);
    const bounds = (mesh: Mesh) => { mesh.geometry.computeBoundingBox(); return mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld); };
    const top = bounds(group.getObjectByName('Instrument / tabletop') as Mesh), apron = bounds(group.getObjectByName('Instrument / joined underframe') as Mesh);
    return group.children.filter(child => child.name === 'Instrument / connected support').map(child => {
      const leg = bounds(child as Mesh);
      return { floor: leg.min.y, top: leg.intersectsBox(top), apron: leg.intersectsBox(apron), overlap: leg.max.y - top.min.y };
    });
  });
  expect(joints).toHaveLength(2);
  for (const joint of joints) { expect(joint.floor).toBeCloseTo(0); expect(joint.top).toBe(true); expect(joint.apron).toBe(true); expect(joint.overlap).toBeGreaterThan(.05); }
  await page.evaluate(config => {
    const app = window.sdpUnified; app.player.setEnabled(false);
    app.scene.camera.position.set(config.x + 3.4, .8, config.z + 3.6); app.scene.camera.lookAt(config.x, .7, config.z);
  }, ambientStation);
  await page.waitForTimeout(400); await page.screenshot({ path: '/private/tmp/sdp-instrument-connected-supports.png' });
});

async function enter(page: Page, name: string): Promise<void> {
  await page.goto('/?debugMode=limbo');
  await expect(page.locator('.ui')).toHaveAttribute('data-sculpture', 'loaded');
  await enterExhibition(page, name);
}
async function approach(page: Page): Promise<void> {
  await page.bringToFront();
  if (await page.locator('.resume-button').isVisible()) await page.locator('.resume-button').click();
  await page.evaluate(config => {
    const app = window.sdpUnified, snapshot = app.network.snapshot!, local = snapshot.players.find(p => p.playerId === snapshot.localPlayerId)!;
    app.player.setSpawn({ ...local, yaw: Math.atan2(-(config.x - local.x), -(config.z + 1.8 - local.z)), pitch: 0 });
  }, ambientStation);
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
  try {
    await expect.poll(() => page.evaluate(config => {
      const snapshot = window.sdpUnified.network.snapshot!, local = snapshot.players.find(p => p.playerId === snapshot.localPlayerId)!;
      return Math.hypot(local.x - config.x, local.z - config.z);
    }, ambientStation), { timeout: 25000, intervals: [80] }).toBeLessThan(2.3);
  } finally { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); }
  await page.waitForTimeout(350);
  await page.evaluate(config => {
    const app = window.sdpUnified, snapshot = app.network.snapshot!, local = snapshot.players.find(p => p.playerId === snapshot.localPlayerId)!;
    app.player.setSpawn({ ...local, yaw: Math.atan2(-(config.x - local.x), -(config.z - local.z)), pitch: Math.atan2(1.12 - local.y, Math.hypot(config.x - local.x, config.z - local.z)) });
  }, ambientStation);
  await expect(page.getByRole('button', { name: 'Play field instrument', exact: true })).toBeVisible();
}

test('ambient instrument: two browsers hear real synth and granular audio, share loops and protect the performer', async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext();
  const first = await a.newPage(), second = await b.newPage(), errors: string[] = [], requests: string[] = [];
  for (const page of [first, second]) page.on('pageerror', e => errors.push(e.message));
  first.on('request', request => requests.push(request.url()));
  try {
    await enter(first, 'Field Artist');
    expect(requests.some(url => url.includes('AmbientSynth'))).toBe(false);
    expect(requests.some(url => url.includes('/shooter/'))).toBe(false);
    await enter(second, 'Field Listener');
    await second.evaluate(config => {
      const app = window.sdpUnified; app.player.setEnabled(false); app.scene.camera.position.set(config.x + 4, 1.7, config.z + 4); app.scene.camera.lookAt(config.x, 1, config.z);
    }, ambientStation);
    await approach(first); await first.keyboard.press('KeyE');
    const panel = first.getByRole('dialog', { name: 'SDP field instrument' }); await expect(panel).toBeVisible();
    await expect.poll(() => first.evaluate(() => window.sdpUnified.instrument.audioDiagnostics.loaded)).toBe(true);
    await expect.poll(() => second.evaluate(() => window.sdpUnified.instrument.audioDiagnostics.loaded)).toBe(true);
    const owner = await first.evaluate(() => window.sdpUnified.instrument.snapshot!.ownerId);
    await second.evaluate(() => window.sdpUnified.network.sendStation({ type: 'transport', playing: true }));
    await second.waitForTimeout(200); expect(await second.evaluate(() => window.sdpUnified.instrument.snapshot!.playing)).toBe(false);
    await first.keyboard.down('KeyA');
    await expect.poll(() => first.evaluate(() => window.sdpUnified.instrument.audioDiagnostics.level)).toBeGreaterThan(.0001);
    await expect.poll(() => second.evaluate(() => window.sdpUnified.instrument.audioDiagnostics.level)).toBeGreaterThan(.0001);
    await first.keyboard.up('KeyA');
    await panel.getByRole('button', { name: 'Record selected track' }).click();
    await expect(panel.getByRole('button', { name: 'Record selected track' })).toHaveAttribute('aria-pressed', 'true');
    await panel.focus(); await first.keyboard.down('KeyA'); await first.waitForTimeout(450); await first.keyboard.up('KeyA');
    await panel.getByRole('button', { name: 'Record selected track' }).click();
    await expect.poll(() => second.evaluate(() => window.sdpUnified.instrument.snapshot!.tracks[0].notes.length)).toBe(1);
    const localPosition = await first.evaluate(() => window.sdpUnified.scene.camera.position.toArray());
    await panel.focus(); await first.keyboard.down('KeyW'); await first.waitForTimeout(250); await first.keyboard.up('KeyW');
    const after = await first.evaluate(() => window.sdpUnified.scene.camera.position.toArray());
    expect(Math.hypot(after[0] - localPosition[0], after[2] - localPosition[2])).toBeLessThan(.05);
    expect(await first.evaluate(() => window.sdpUnified.scene.inspection.active)).toBe(false);
    await panel.getByRole('button', { name: 'Select track 3' }).click(); await panel.focus();
    await first.keyboard.down('KeyE'); await first.waitForTimeout(700);
    await expect.poll(() => second.evaluate(() => window.sdpUnified.instrument.audioDiagnostics.level)).toBeGreaterThan(.0001);
    await first.keyboard.up('KeyE');
    await panel.getByRole('button', { name: 'Record selected track' }).click(); await panel.focus();
    await first.keyboard.down('KeyD'); await first.waitForTimeout(400); await first.keyboard.up('KeyD');
    await panel.getByRole('button', { name: 'Record selected track' }).click();
    await expect.poll(() => second.evaluate(() => window.sdpUnified.instrument.snapshot!.tracks[2].notes.length)).toBe(1);
    await expect.poll(() => second.evaluate(() => window.sdpUnified.instrument.audioDiagnostics.scheduled), { timeout: 20000 }).toBeGreaterThan(0);
    expect(await second.evaluate(() => window.sdpUnified.instrument.snapshot!.ownerId)).toBe(owner);
    const startedAt = await first.evaluate(() => window.sdpUnified.instrument.snapshot!.startedAt);
    await enter(second, 'Late Listener');
    await second.evaluate(config => {
      const app = window.sdpUnified; app.player.setEnabled(false); app.scene.camera.position.set(config.x + 4, 1.7, config.z + 4); app.scene.camera.lookAt(config.x, 1, config.z);
    }, ambientStation);
    await expect.poll(() => second.evaluate(() => window.sdpUnified.instrument.snapshot?.startedAt)).toBe(startedAt);
    await expect.poll(() => second.evaluate(() => window.sdpUnified.instrument.audioDiagnostics.scheduled), { timeout: 20000 }).toBeGreaterThan(0);
    await first.bringToFront();
    await first.screenshot({ path: '/private/tmp/sdp-ambient-instrument-desktop.png' });
    await first.keyboard.press('Escape'); await expect(panel).toBeHidden();
    await expect.poll(() => second.evaluate(() => window.sdpUnified.instrument.snapshot!.ownerId)).toBe('');
    expect(await second.evaluate(() => window.sdpUnified.instrument.snapshot!.playing)).toBe(true);
    await first.keyboard.press('KeyP');
    await first.getByRole('slider', { name: 'Game volume', exact: true }).fill('0');
    await first.keyboard.press('KeyP');
    await expect.poll(() => first.evaluate(() => window.sdpUnified.instrument.audioDiagnostics.level), { timeout: 8000 }).toBeLessThan(.00001);
    expect(errors).toEqual([]);
    expect(requests.some(url => url.includes('/shooter/'))).toBe(false);
  } finally { await a.close(); await b.close(); }
});

test('ambient instrument: mobile piano is playable and the station and benches render without overlaps', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), page = await context.newPage();
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await enter(page, 'Touch Artist'); await approach(page);
    await page.getByRole('button', { name: 'Play field instrument', exact: true }).tap();
    const panel = page.getByRole('dialog', { name: 'SDP field instrument' }); await expect(panel).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.sdpUnified.instrument.audioDiagnostics.loaded)).toBe(true);
    await page.getByRole('button', { name: 'Play MIDI note 48', exact: true }).tap();
    await expect.poll(() => page.evaluate(() => window.sdpUnified.instrument.audioDiagnostics.level)).toBeGreaterThan(.00001);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: '/private/tmp/sdp-ambient-instrument-mobile.png' });
    await page.getByRole('button', { name: 'Leave instrument (Esc)' }).tap(); await expect(panel).toBeHidden();
    await page.evaluate(config => {
      const app = window.sdpUnified; app.player.setEnabled(false); app.scene.camera.position.set(config.x + 7, 3.4, config.z + 9); app.scene.camera.lookAt(config.x, .8, config.z);
      app.scene.renderer.render(app.scene.scene, app.scene.camera);
    }, ambientStation);
    await page.waitForTimeout(500); await page.screenshot({ path: '/private/tmp/sdp-ambient-zone-mobile.png' });
    const pixels = await page.evaluate(() => {
      const { renderer, scene, camera } = window.sdpUnified.scene; renderer.render(scene, camera);
      const gl = renderer.getContext(), pixel = new Uint8Array(4); gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); return [...pixel];
    });
    expect(pixels[3]).toBe(255); expect(pixels[0]).toBeGreaterThan(10); expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('ambient instrument: separate listening area frames its six surrounding benches on desktop', async ({ page }) => {
  await enter(page, 'Field Overview');
  await page.evaluate(config => {
    const app = window.sdpUnified; app.player.setEnabled(false); app.scene.camera.position.set(config.x, 5, config.z + 16); app.scene.camera.lookAt(config.x, .75, config.z + 1);
  }, ambientStation);
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => {
    const { renderer, scene, camera, environment } = window.sdpUnified.scene; renderer.render(scene, camera);
    const visible = environment.retreat.seats.slice(3, 9).every(seat => { const p = seat.position.clone().project(camera); return Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z < 1; });
    const gl = renderer.getContext(), pixel = new Uint8Array(4); gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return { visible, benches: environment.retreat.seats.slice(3, 9).length, pixel: [...pixel], meshes: environment.instrument.group.children.length };
  });
  expect(result.visible).toBe(true); expect(result.benches).toBe(6); expect(result.meshes).toBeGreaterThan(20); expect(result.pixel[3]).toBe(255); expect(result.pixel[0]).toBeGreaterThan(10);
  await page.screenshot({ path: '/private/tmp/sdp-ambient-zone-desktop.png' });
});

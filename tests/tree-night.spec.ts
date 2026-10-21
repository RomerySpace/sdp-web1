import { test, expect } from '@playwright/test';
import { treeNightTarget } from '../src/scene/TreeNight';
import { lobbyRetreat } from '../shared/LobbyRetreat';
import { enterExhibition } from './entry';

test('tree night: bounded, gradual proximity without affecting the gallery or other modes', () => {
  const point = { x: lobbyRetreat.x, y: 1.8, z: lobbyRetreat.z };
  expect(treeNightTarget(point, true)).toBe(1);
  expect(treeNightTarget({ ...point, z: point.z + 26 }, true)).toBe(0);
  const middle = treeNightTarget({ ...point, z: point.z + 15 }, true);
  expect(middle).toBeGreaterThan(0); expect(middle).toBeLessThan(1);
  expect(treeNightTarget({ ...point, y: -5.4 }, true)).toBe(0);
  expect(treeNightTarget(point, false)).toBe(0);
});

for (const mobile of [false, true]) test(`tree night: rendered transition and restoration ${mobile ? 'mobile' : 'desktop'}`, async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /WebGLProgram|shader error|VALIDATE_STATUS/.test(message.text())) errors.push(message.text()); });
  try {
    await page.goto(`${baseURL}/?debugMode=limbo`); await enterExhibition(page, 'Tree night check');
    await page.evaluate(async () => { await window.sdpUnified.scene.environment.retreat.ready; window.sdpUnified.player.reconcile = () => {}; });
    await page.addStyleTag({ content: '.mode-diagnostics { display: none; }' });
    const move = async (distance: number) => page.evaluate(({ x, z, distance }) => {
      const app = window.sdpUnified, s = app.network.snapshot!, p = s.players.find(p => p.playerId === s.localPlayerId)!;
      app.player.setSpawn({ ...p, x, y: 1.8, z: z + distance, yaw: 0, pitch: .08 }); app.player.setEnabled(false);
    }, { x: lobbyRetreat.x, z: lobbyRetreat.z, distance });
    await move(26); await expect.poll(() => page.evaluate(() => window.sdpUnified.scene.treeNightAmount)).toBeLessThan(.005);
    await page.screenshot({ path: `/private/tmp/sdp-tree-day-${mobile ? 'mobile' : 'desktop'}.png` });
    await move(8); await page.waitForTimeout(180);
    const intermediate = await page.evaluate(() => window.sdpUnified.scene.treeNightAmount);
    expect(intermediate).toBeGreaterThan(0); expect(intermediate).toBeLessThan(.8);
    await expect.poll(() => page.evaluate(() => window.sdpUnified.scene.treeNightAmount)).toBeGreaterThan(.98);
    const pixels = await page.evaluate(() => {
      const s = window.sdpUnified.scene, night = s.treeNightAmount;
      const gl = s.renderer.getContext(), bytes = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      const read = () => { s.renderer.render(s.scene, s.camera); gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, bytes); return bytes.slice(); };
      const nocturnal = read(); s.fireflies.mesh.visible = false; const without = read(); s.fireflies.mesh.visible = true;
      s.lighting.update(0); s.atmosphere.update(30, 1, s.camera, 0); const daytime = read();
      s.lighting.update(night); s.atmosphere.update(30, 1, s.camera, night);
      let dark = 0, light = 0, sparks = 0;
      for (let i = 0; i < bytes.length; i += 4) {
        dark += nocturnal[i] + nocturnal[i + 1] + nocturnal[i + 2]; light += daytime[i] + daytime[i + 1] + daytime[i + 2];
        if (Math.abs(nocturnal[i] - without[i]) + Math.abs(nocturnal[i + 1] - without[i + 1]) + Math.abs(nocturnal[i + 2] - without[i + 2]) > 12) sparks++;
      }
      return { dark: dark / bytes.length, light: light / bytes.length, sparks };
    });
    expect(pixels.dark).toBeGreaterThan(2); expect(pixels.dark).toBeLessThan(pixels.light * .7); expect(pixels.sparks).toBeGreaterThan(5);
    await page.screenshot({ path: `/private/tmp/sdp-tree-night-${mobile ? 'mobile' : 'desktop'}.png` });
    await move(26); await expect.poll(() => page.evaluate(() => window.sdpUnified.scene.treeNightAmount)).toBeLessThan(.005);
    expect(await page.evaluate(() => window.sdpUnified.scene.scene.environmentIntensity)).toBeCloseTo(.38, 2);
    expect(errors).toEqual([]);
    console.log(JSON.stringify({ mobile, ...pixels, restored: true }));
  } finally { await context.close(); }
});

import { test, expect } from '@playwright/test';
import { CollisionManager } from '../src/player/CollisionManager';
import { inCaptureStudio, temporaryCaptureStudio } from '../shared/TemporaryCaptureStudio';
import { spawnPosition } from '../server/src/simulation/SpawnPositions';
import { enterExhibition } from './entry';

test('temporary studio: solid walls, walkable doorway and no displaced spawn points', () => {
  const world = new CollisionManager();
  expect(inCaptureStudio(-20, 10)).toBe(true); expect(inCaptureStudio(0, 9)).toBe(false);
  expect(world.canOccupy(-12, 10)).toBe(true);
  expect(world.canOccupy(-12, 5)).toBe(false);
  expect(world.canOccupy(-28, 10)).toBe(false);
  expect(world.canOccupy(-20, 17)).toBe(false);
  expect(world.canOccupy(-15.5, 10)).toBe(false);
  for (let i = 0; i < 25; i++) { const p = spawnPosition(i); expect(world.canOccupy(p.x, p.z)).toBe(true); }
  const p = { x: -10, z: 10, groundY: 0 };
  for (const [dx, dz, steps] of [[-.1, 0, 35], [0, .1, 40], [-.1, 0, 65], [0, -.1, 40]])
    for (let i = 0; i < steps; i++) world.move(p, dx, dz);
  expect(p.x).toBeCloseTo(-20); expect(p.z).toBeCloseTo(10);
});

for (const mobile of [false, true]) test(`temporary studio: black particle capture ${mobile ? 'mobile' : 'desktop'}`, async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage(), errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  page.on('console', message => { if (message.type() === 'error' && /WebGLProgram|shader error|VALIDATE_STATUS/.test(message.text())) errors.push(message.text()); });
  try {
    await page.goto(`${baseURL}/?debugMode=limbo`); await enterExhibition(page, 'Capture studio');
    await page.evaluate(async () => {
      const app = window.sdpUnified;
      await app.scene.captureStudio.ready;
      app.player.reconcile = () => {};
      const s = app.network.snapshot!, p = s.players.find(p => p.playerId === s.localPlayerId)!;
      app.player.setSpawn({ ...p, x: -16.2, y: 3.1, z: 10, yaw: Math.PI / 2, pitch: 0 });
      app.player.setEnabled(false);
    });
    await page.addStyleTag({ content: '.ui,.mode-diagnostics,.mode-overlay,.settings-overlay,.touch-controls,.now-playing { display:none!important; }' });
    await expect.poll(() => page.evaluate(() => window.sdpUnified.scene.captureStudio.group.visible)).toBe(true);
    const stats = await page.evaluate(() => {
      const s = window.sdpUnified.scene, clouds = s.captureStudio.group.children.filter(g => g.name.startsWith('Capture cloud'));
      const gl = s.renderer.getContext(), bytes = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      s.renderer.render(s.scene, s.camera);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      let black = 0, lit = 0;
      for (let i = 0; i < bytes.length; i += 4) {
        const peak = Math.max(bytes[i], bytes[i + 1], bytes[i + 2]);
        if (peak < 4) black++; if (peak > 30) lit++;
      }
      return { clouds: clouds.length, black: black / (bytes.length / 4), lit, rain: s.rain.mesh.visible,
        abstract: clouds.every((cloud, i) => (cloud.children[0] as any).geometry !== s.graphics.loadedAssets[i].lines) };
    });
    expect(stats.clouds).toBe(3); expect(stats.abstract).toBe(true);
    expect(stats.black).toBeGreaterThan(.85); expect(stats.lit).toBeGreaterThan(500); expect(stats.rain).toBe(false);
    await page.screenshot({ path: `/private/tmp/sdp-capture-studio-${mobile ? 'mobile' : 'desktop'}.png` });
    const first = await page.evaluate(() => window.sdpUnified.scene.captureStudio.group.children.find(g => g.name.startsWith('Capture cloud'))!.position.y);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.sdpUnified.scene.captureStudio.group.children.find(g => g.name.startsWith('Capture cloud'))!.position.y)).not.toBe(first);
    expect(requests.filter(url => /Dust|dust|shooter-physics|ShooterMode/.test(url))).toEqual([]);
    expect(errors).toEqual([]);
    console.log(JSON.stringify({ mobile, ...stats, studio: temporaryCaptureStudio.enabled }));
  } finally { await context.close(); }
});

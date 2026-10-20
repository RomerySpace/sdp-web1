import { test, expect, type Page } from '@playwright/test';
import { enterExhibition } from './entry';
import { touchDriver } from './touch-driver';
import { lowerGallery } from '../shared/LowerGallery';
import { lobbySeatSlots } from '../shared/LobbyRetreat';
import { Box3, ObjectLoader, Raycaster, Vector3 } from 'three';

async function expectRenderedGallery(page: Page): Promise<void> {
  const pixels = await page.evaluate(() => {
    const { renderer, scene, camera } = window.sdpUnified.scene; renderer.render(scene, camera);
    const gl = renderer.getContext(), colors: string[] = [], levels: number[] = []; let opaque = true;
    for (const x of [.2, .35, .5, .65, .8]) for (const y of [.2, .4, .6, .8]) {
      const p = new Uint8Array(4); gl.readPixels(Math.floor(gl.drawingBufferWidth * x), Math.floor(gl.drawingBufferHeight * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
      colors.push([...p.slice(0, 3)].join(',')); levels.push(p[0] + p[1] + p[2]); opaque &&= p[3] === 255;
    }
    return { unique: new Set(colors).size, contrast: Math.max(...levels) - Math.min(...levels), opaque };
  });
  expect(pixels.opaque).toBe(true); expect(pixels.unique).toBeGreaterThan(3); expect(pixels.contrast).toBeGreaterThan(45);
}

async function resume(page: Page): Promise<void> {
  await page.bringToFront(); const button = page.locator('.resume-button');
  if (await button.isVisible()) {
    try { await button.click({ timeout: 1500 }); }
    catch (error) { if (await page.locator('.ui').getAttribute('data-state') !== 'EXPLORING') throw error; }
  }
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
}
async function walk(page: Page, x: number, z: number, touch: boolean, radius = 1): Promise<void> {
  await resume(page);
  await page.evaluate(point => {
    const app = window.sdpUnified, snapshot = app.network.snapshot!, local = snapshot.players.find(p => p.playerId === snapshot.localPlayerId)!;
    app.player.setSpawn({ ...local, yaw: Math.atan2(-(point.x - local.x), -(point.z - local.z)), pitch: 0 });
  }, { x, z });
  let release: () => Promise<void>;
  if (touch) {
    await page.getByRole('button', { name: 'Sprint', exact: true }).tap();
    const driver = await touchDriver(page), rect = (await page.locator('.touch-stick').boundingBox())!;
    await driver.down(1, rect.x + rect.width / 2, rect.y + rect.height / 2); await driver.move(1, rect.x + rect.width / 2, rect.y + rect.height * .05);
    release = async () => { await driver.up(1); await page.getByRole('button', { name: 'Sprint', exact: true }).tap(); };
  } else {
    await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
    release = async () => { await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); };
  }
  try {
    await expect.poll(() => page.evaluate(point => {
      const app = window.sdpUnified, snapshot = app.network.snapshot!, local = snapshot.players.find(p => p.playerId === snapshot.localPlayerId)!;
      return Math.hypot(local.x - point.x, local.z - point.z);
    }, { x, z }), { timeout: 20000, intervals: [50] }).toBeLessThan(radius);
  } catch (error) {
    console.log('Gallery navigation failure', await page.evaluate(() => {
      const app = window.sdpUnified, snapshot = app.network.snapshot!;
      return { local: snapshot.players.find(p => p.playerId === snapshot.localPlayerId), camera: app.scene.camera.position.toArray(),
        yaw: app.scene.camera.rotation.y, input: { f: app.player.input.forward, r: app.player.input.sideways }, hidden: document.hidden };
    }));
    throw error;
  } finally { await release(); }
  await page.waitForTimeout(300);
}
async function descend(page: Page, touch: boolean): Promise<void> {
  await walk(page, 8, 14, touch); await walk(page, 32, 14, touch);
  if (!touch) {
    await page.evaluate(() => { const app = window.sdpUnified; app.player.setEnabled(false); app.scene.camera.position.set(20, 1.8, 8); app.scene.camera.lookAt(20, 0, 0); });
    await page.waitForTimeout(250); await page.screenshot({ path: '/private/tmp/sdp-gallery-exterior-ground.png' });
    await page.evaluate(() => window.sdpUnified.player.setEnabled(true));
  }
  await walk(page, 32, lowerGallery.stairZ, touch);
  if (!touch) {
    await page.evaluate(() => { const app = window.sdpUnified, s = app.network.snapshot!; app.player.setSpawn({ ...s.players.find(p => p.playerId === s.localPlayerId)!, yaw: Math.PI / 2, pitch: -.38 }); });
    await page.waitForTimeout(250); await page.screenshot({ path: '/private/tmp/sdp-lower-gallery-stair-entrance.png' });
  }
  await walk(page, 21, lowerGallery.stairZ, touch);
  if (!touch) {
    await page.waitForTimeout(300); await page.screenshot({ path: '/private/tmp/sdp-lower-gallery-stair-landing.png' });
    await page.evaluate(() => { const app = window.sdpUnified, s = app.network.snapshot!; app.player.setSpawn({ ...s.players.find(p => p.playerId === s.localPlayerId)!, yaw: Math.PI / 2 - .5, pitch: .4 }); });
    await page.waitForTimeout(250); await page.screenshot({ path: '/private/tmp/sdp-gallery-ceiling-oblique.png' });
  }
  await walk(page, 10, lowerGallery.stairZ, touch);
  await expect.poll(() => page.evaluate(() => window.sdpUnified.scene.camera.position.y)).toBeLessThan(-5.2);
}

test('lower gallery: two visitors descend, see the real film, sit below the monolith and return upstairs', async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const first = await a.newPage(), second = await b.newPage(), errors: string[] = [], requests: string[] = [];
  for (const page of [first, second]) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /WebGLProgram|VALIDATE_STATUS|shader error/i.test(message.text())) errors.push(message.text()); });
  }
  first.on('request', request => requests.push(request.url()));
  try {
    await first.goto('/?debugMode=limbo'); await enterExhibition(first, 'Gallery Visitor');
    expect(requests.some(url => url.includes('/gallery/kenosis.mp4'))).toBe(false);
    await second.goto('/?debugMode=limbo'); await enterExhibition(second, 'Gallery Listener');
    await descend(first, false); await descend(second, true); await walk(second, 8, -6, true);
    await first.bringToFront(); await resume(first);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.scene.environment.gallery.film.diagnostics.ready), { timeout: 20000 }).toBeGreaterThanOrEqual(2);
    if (await first.getByRole('button', { name: 'Enable film audio' }).isVisible()) { await first.keyboard.press('Escape'); await first.getByRole('button', { name: 'Enable film audio' }).click(); await resume(first); }
    await expect.poll(() => first.evaluate(() => window.sdpUnified.scene.environment.gallery.film.diagnostics.playing)).toBe(true);
    const frames = await first.evaluate(() => window.sdpUnified.scene.environment.gallery.film.diagnostics.frames);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.scene.environment.gallery.film.diagnostics.frames)).toBeGreaterThan(frames);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.scene.environment.gallery.film.diagnostics.level), { timeout: 10000 }).toBeGreaterThan(.00001);
    const metadata = await first.evaluate(() => window.sdpUnified.scene.environment.gallery.film.diagnostics);
    console.log('Gallery film metadata', JSON.stringify(metadata));
    expect(metadata.width).toBeGreaterThan(0); expect(metadata.error).toBeUndefined();
    const shell = await first.evaluate(() => {
      const scene = window.sdpUnified.scene.scene;
      return ['Gallery / continuous sloped stair ceiling', 'Gallery / seamless curved mineral floor', 'Gallery / continuous quiet ceiling', 'Gallery / protected entrance end'].map(name => scene.getObjectByName(name)!.toJSON());
    });
    const loader = new ObjectLoader(), solids = shell.map(json => loader.parse(json)); solids.forEach(mesh => mesh.updateMatrixWorld());
    expect(new Box3().setFromObject(solids[0]).max.y).toBeLessThan(-.07);
    const entrance = new Box3().setFromObject(solids[3]);
    expect(entrance.min.y).toBeLessThanOrEqual(-.239);
    const slitRay = new Raycaster(new Vector3(lowerGallery.openStairStart + 1, -.04, 0), new Vector3(-1, 0, 0));
    expect(slitRay.intersectObject(solids[3]).length).toBeGreaterThan(0);
    const ray = new Raycaster(new Vector3(16, -1.4, 0), new Vector3(-1, .2, 0).normalize());
    expect(ray.intersectObject(solids[0]).length).toBeGreaterThan(0);
    ray.set(new Vector3(11.95, -5.4, 0), new Vector3(0, -1, 0));
    expect(ray.intersectObject(solids[1])[0].point.y).toBeCloseTo(lowerGallery.floorY, 4);
    ray.set(new Vector3(0, -5.4, 0), new Vector3(0, 1, 0));
    expect(ray.intersectObject(solids[2])[0].point.y).toBeCloseTo(lowerGallery.ceilingY, 4);
    ray.set(new Vector3(16, -.3, 0), new Vector3(-1, 0, 0));
    expect(ray.intersectObject(solids[2]).length).toBeGreaterThan(0);
    await first.evaluate(() => { const app = window.sdpUnified; app.player.setEnabled(false); app.scene.camera.position.set(10, -5.4, 6); app.scene.camera.lookAt(-7, -4.5, -1); });
    await first.waitForTimeout(400); await expectRenderedGallery(first); await first.screenshot({ path: '/private/tmp/sdp-lower-gallery-room.png' });
    await first.evaluate(() => { const app = window.sdpUnified; app.scene.camera.position.set(-9.2, -5.75, -3.4); app.scene.camera.lookAt(-11.73, -5.75, -3.4); });
    await first.waitForTimeout(250); await first.screenshot({ path: '/private/tmp/sdp-lower-gallery-label.png' });
    await first.evaluate(() => { const app = window.sdpUnified; app.player.setEnabled(true); });
    const seatIndex = lobbySeatSlots.findIndex(seat => seat.groundY === lowerGallery.floorY && Math.abs(seat.z) < 1), seat = lobbySeatSlots[seatIndex];
    // Restore the camera to its authoritative position before exercising seating.
    await first.evaluate(() => { const app = window.sdpUnified, snapshot = app.network.snapshot!; app.player.setSpawn(snapshot.players.find(p => p.playerId === snapshot.localPlayerId)!); });
    await walk(first, seat.x, seat.z, false, 1.6);
    await first.evaluate(seat => {
      const app = window.sdpUnified, snapshot = app.network.snapshot!, local = snapshot.players.find(p => p.playerId === snapshot.localPlayerId)!;
      app.player.setSpawn({ ...local, yaw: Math.atan2(-(seat.x - local.x), -(seat.z - local.z)), pitch: Math.atan2(seat.groundY + .46 - local.y, Math.hypot(seat.x - local.x, seat.z - local.z)) });
    }, seat);
    await expect(first.getByRole('button', { name: 'Sit on bench', exact: true })).toBeVisible(); await first.keyboard.press('KeyE');
    await expect.poll(() => second.evaluate(() => window.sdpUnified.network.snapshot!.players.find(p => p.displayName === 'Gallery Visitor')?.seatIndex)).toBe(seatIndex);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.scene.camera.position.y)).toBeLessThan(-5.9);
    await second.bringToFront();
    await second.evaluate(() => { const app = window.sdpUnified; app.player.setEnabled(false); app.scene.camera.position.set(7, -5.4, -5); app.scene.camera.lookAt(-6, -4.7, -1); });
    await second.waitForTimeout(350); await expectRenderedGallery(second); await second.screenshot({ path: '/private/tmp/sdp-lower-gallery-mobile.png' });
    await second.setViewportSize({ width: 844, height: 390 }); await second.waitForTimeout(250); await expectRenderedGallery(second); await second.screenshot({ path: '/private/tmp/sdp-lower-gallery-mobile-landscape.png' });
    await first.bringToFront(); await resume(first); await first.keyboard.press('KeyE');
    await expect.poll(() => first.evaluate(() => window.sdpUnified.player.seated)).toBe(false);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.scene.camera.position.y)).toBeLessThan(-5.3);
    await walk(first, 0, 6, false); await walk(first, 10, lowerGallery.stairZ, false); await walk(first, 32, lowerGallery.stairZ, false);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.scene.camera.position.y)).toBeGreaterThan(1.7);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.scene.environment.gallery.film.diagnostics.playing)).toBe(false);
    expect(requests.some(url => url.includes('/shooter/'))).toBe(false); expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); }
});

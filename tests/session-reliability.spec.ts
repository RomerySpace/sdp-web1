import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { createServer as netServer } from 'node:net';
import { airstrikeFixture } from '../server/tests/airstrike-fixture';
import type { SDPLobby } from '../server/src/rooms/SDPLobby';
import type { MovementSimulation } from '../server/src/simulation/MovementSimulation';
import type { RoomInactivity } from '../server/src/communication/RoomInactivity';
import { lobbySeatSlots } from '../shared/LobbyRetreat';
import { sessionPolicy } from '../shared/SessionPolicy';
import { enterExhibition } from './entry';
import { ambientStation } from '../shared/AmbientStation';
import { lowerGallery, galleryListening } from '../shared/LowerGallery';

let fixture: Awaited<ReturnType<typeof airstrikeFixture>>, vite: ViteDevServer, url: string;
test.beforeAll(async () => {
  fixture = await airstrikeFixture();
  const server = netServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve()));
  Object.assign(process.env, { SDP_BACKEND_PORT: String(fixture.port), SDP_WEB_PORT: String(port), VITE_SDP_SERVER_URL: '/multiplayer' });
  vite = await createServer({ root: process.cwd(), mode: 'unified', server: { host: '127.0.0.1', port, strictPort: true } });
  await vite.listen(); url = `http://127.0.0.1:${port}`;
});
test.afterAll(async () => { await vite?.close(); await fixture?.server.gracefullyShutdown(false); });

test('gallery headphones: keyboard and touch listen simultaneously, show remote headsets and stop at the exit', async ({ browser }) => {
  const desktop = await browser.newContext(), mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const first = await desktop.newPage(), second = await mobile.newPage(), errors: string[] = [];
  try {
    for (const [page, name] of [[first, 'Headphone visitor'], [second, 'Touch listener']] as const) {
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${url}/?debugMode=limbo`); await enterExhibition(page, name);
    }
    const ids = await Promise.all([first, second].map(page => page.evaluate(() => ({ id: window.sdpUnified.network.snapshot!.localPlayerId, room: window.sdpUnified.network.snapshot!.roomId }))));
    const room = fixture.room(ids[0].room) as unknown as SDPLobby;
    // Delay real gameplay frames in both directions after SDK room handshakes.
    for (const client of room.clients) {
      const send = client.raw.bind(client), socket = client.ref as typeof client.ref & { readyState: number }, emit = socket.emit.bind(socket);
      client.raw = (data, options, callback) => {
        const copy = Buffer.from(data);
        setTimeout(() => { if (socket.readyState === 1) send(copy, options, callback); }, 150);
      };
      socket.emit = ((event: string | symbol, ...args: unknown[]) => {
        if (event !== 'message') return emit(event, ...args);
        setTimeout(() => { if (socket.readyState === 1) emit(event, ...args); }, 150); return true;
      }) as typeof socket.emit;
    }
    const place = (id: string, x: number, z: number, groundY: number = lowerGallery.floorY) => {
      const player = room.state.players.get(id)!; player.x = x; player.z = z; player.y = groundY + 1.8;
      (room as unknown as { simulation: MovementSimulation }).simulation.add(id, { x, z, groundY });
    };
    for (const [index, page] of [first, second].entries()) {
      place(ids[index].id, -9.5, galleryListening.z + index * .6);
      await page.bringToFront();
      if (await page.locator('.resume-button').isVisible()) await page.locator('.resume-button').click();
      await expect.poll(() => page.evaluate(() => window.sdpUnified.scene.camera.position.x)).toBeCloseTo(-9.5, 1);
      await page.evaluate(target => {
        const app = window.sdpUnified, s = app.network.snapshot!, p = s.players.find(p => p.playerId === s.localPlayerId)!;
        app.player.setSpawn({ ...p, yaw: Math.atan2(-(target.x - p.x), -(target.z - p.z)), pitch: Math.atan2(target.y + .1 - p.y, Math.hypot(target.x - p.x, target.z - p.z)) });
      }, galleryListening);
      const button = page.getByRole('button', { name: 'Listen to Kenosis', exact: true }); await expect(button).toBeVisible();
      if (!index) {
        const client = room.clients.find(c => c.sessionId === ids[index].id)!, send = client.send.bind(client);
        let dropped = false;
        client.send = ((type: string, ...args: unknown[]) => {
          if (type === 'gallery:result' && !dropped) { dropped = true; return; }
          return (send as (...args: unknown[]) => void)(type, ...args);
        }) as typeof client.send;
      }
      if (index) await button.tap(); else await page.keyboard.press('KeyE');
      await expect.poll(() => page.evaluate(() => window.sdpUnified.scene.environment.gallery.film.listening)).toBe(true);
      await expect.poll(() => page.evaluate(() => window.sdpUnified.scene.environment.gallery.film.diagnostics.level)).toBeGreaterThan(.00001);
    }
    expect([...room.state.players.values()].filter(p => p.listening).length).toBe(2);
    await expect.poll(() => second.evaluate(id => window.sdpUnified.scene.remotePlayers.group.getObjectByName(`Visitor:${id}`)?.getObjectByName('Gallery headphones')?.visible, ids[0].id)).toBe(true);
    await second.evaluate(id => {
      const app = window.sdpUnified, p = app.network.snapshot!.players.find(p => p.playerId === id)!;
      app.player.setEnabled(false); app.scene.camera.position.set(-8, -5.4, 1); app.scene.camera.lookAt(p.x, -5.8, p.z);
    }, ids[0].id);
    await second.screenshot({ path: '/private/tmp/sdp-gallery-remote-headphones-mobile.png' });
    await second.evaluate(() => window.sdpUnified.player.setEnabled(true));
    place(ids[1].id, 8, 0);
    await expect.poll(() => second.evaluate(() => window.sdpUnified.scene.environment.gallery.film.listening)).toBe(false);
    await expect.poll(() => second.evaluate(() => window.sdpUnified.scene.environment.gallery.film.diagnostics.level)).toBeLessThan(.00001);
    expect(room.state.players.get(ids[0].id)!.listening).toBe(true);
    await first.bringToFront();
    if (await first.locator('.resume-button').isVisible()) await first.locator('.resume-button').click();
    await expect(first.getByRole('button', { name: 'Return gallery headphones', exact: true })).toBeVisible();
    await first.keyboard.press('KeyE');
    await expect.poll(() => first.evaluate(() => window.sdpUnified.scene.environment.gallery.film.listening)).toBe(false);
    // The camera can be stale just before E. The interaction must settle the real
    // position and terminate with an explicit denial, not endless CONNECTING.
    place(ids[0].id, 0, -6);
    await first.evaluate(target => {
      const app = window.sdpUnified, s = app.network.snapshot!, p = s.players.find(p => p.playerId === s.localPlayerId)!;
      app.player.reconcile = () => {};
      app.player.setSpawn({ ...p, x: -9.5, y: -5.4, z: target.z, yaw: Math.PI / 2, pitch: -.5 });
    }, galleryListening);
    await expect(first.getByRole('button', { name: 'Listen to Kenosis', exact: true })).toBeVisible();
    await expect(first.getByRole('button', { name: 'Listen to Kenosis', exact: true })).toBeEnabled();
    await first.keyboard.press('KeyE');
    await expect(first.locator('.ui-notice')).toContainText('Move closer');
    await expect.poll(() => first.evaluate(() => window.sdpUnified.scene.camera.position.x)).toBeCloseTo(0, 1);
    expect(room.state.players.get(ids[0].id)!.listening).toBe(false);
    expect(await first.evaluate(() => ({ room: window.sdpUnified.network.snapshot!.roomId, id: window.sdpUnified.network.snapshot!.localPlayerId }))).toEqual(ids[0]);
    expect(errors).toEqual([]);
  } finally { await desktop.close(); await mobile.close(); }
});

test('instrument E survives focused buttons, lost prediction history and rejected claims without reloading', async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext();
  const first = await a.newPage(), second = await b.newPage(), errors: string[] = [];
  try {
    for (const [page, name] of [[first, 'Keyboard artist'], [second, 'Keyboard witness']] as const) {
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${url}/?debugMode=limbo`); await enterExhibition(page, name);
    }
    await first.bringToFront();
    if (await first.getByRole('button', { name: 'RESUME', exact: true }).isVisible()) await first.getByRole('button', { name: 'RESUME', exact: true }).click();
    const identity = await first.evaluate(() => ({ id: window.sdpUnified.network.snapshot!.localPlayerId, room: window.sdpUnified.network.snapshot!.roomId }));
    const room = fixture.room(identity.room) as unknown as SDPLobby;
    expect(await first.evaluate(() => window.sdpUnified.network.snapshot!.interactionVersion)).toBe(1);
    const place = (x: number, z: number) => {
      const p = room.state.players.get(identity.id)!; p.x = x; p.z = z; p.y = 1.8;
      (room as unknown as { simulation: MovementSimulation }).simulation.add(identity.id, { x, z, groundY: 0 });
    };
    place(ambientStation.x, ambientStation.z + 2.2);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.network.snapshot!.players.find(p => p.playerId === window.sdpUnified.network.snapshot!.localPlayerId)!.x)).toBe(ambientStation.x);
    await first.evaluate(config => {
      const app = window.sdpUnified, s = app.network.snapshot!, p = s.players.find(p => p.playerId === s.localPlayerId)!;
      app.player.setSpawn({ ...p, x: p.x + 9, yaw: 0, pitch: Math.atan2(1.1 - p.y, 2.2) });
      // Reproduce the blind spot: there are no matching input history samples.
      const original = app.player.recordInput.bind(app.player);
      Object.assign(window, { restoreKeyboardHistory: () => app.player.recordInput = original });
      app.player.recordInput = () => {};
      app.scene.camera.lookAt(config.x, 1.1, config.z);
    }, ambientStation);
    await expect.poll(() => first.evaluate(() => {
      const app = window.sdpUnified, s = app.network.snapshot!, p = s.players.find(p => p.playerId === s.localPlayerId)!;
      return Math.hypot(app.scene.camera.position.x - p.x, app.scene.camera.position.z - p.z);
    })).toBeLessThan(.1);
    await first.evaluate(() => (window as unknown as { restoreKeyboardHistory(): void }).restoreKeyboardHistory());
    await expect(first.getByRole('button', { name: 'Play field instrument', exact: true })).toBeVisible();
    await first.locator('.instrument-interaction').focus();
    expect(await first.locator('.instrument-interaction').evaluate(el => el === document.activeElement)).toBe(true);
    await first.keyboard.press('KeyE');
    const panel = first.getByRole('dialog', { name: 'SDP field instrument' }); await expect(panel).toBeVisible();
    expect((room as unknown as { station: { state: { ownerId: string } } }).station.state.ownerId).toBe(identity.id);
    await first.keyboard.press('Escape'); await expect(panel).toBeHidden();
    // Drop both forms of acknowledgement once. The same request must recover automatically.
    const client = room.clients.find(client => client.sessionId === identity.id)!;
    const send = client.send.bind(client), broadcast = room.broadcast.bind(room);
    let droppedReply = false, droppedState = false;
    client.send = ((type: string, ...args: unknown[]) => {
      if (type === 'station:claim-result' && !droppedReply) { droppedReply = true; return; }
      return (send as (...args: unknown[]) => void)(type, ...args);
    }) as typeof client.send;
    room.broadcast = ((type: string, ...args: unknown[]) => {
      if (type === 'station:state' && !droppedState) { droppedState = true; return; }
      return (broadcast as (...args: unknown[]) => void)(type, ...args);
    }) as typeof room.broadcast;
    await expect(first.locator('.instrument-interaction')).toBeVisible();
    await first.keyboard.press('KeyE'); await expect(panel).toBeVisible();
    expect(droppedReply && droppedState).toBe(true);
    client.send = send; room.broadcast = broadcast;
    await first.keyboard.press('Escape'); await expect(panel).toBeHidden();
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(first.locator('.instrument-interaction')).toBeVisible();
      await first.keyboard.press('KeyE'); await expect(panel).toBeVisible();
      await first.keyboard.press('Escape'); await expect(panel).toBeHidden();
    }
    // A half-open connection must not let the camera walk on without server state.
    room.setPatchRate(0);
    await first.keyboard.down('KeyS');
    await expect.poll(() => first.evaluate(() => window.sdpUnified.player.synchronized)).toBe(false);
    const stopped = await first.evaluate(() => window.sdpUnified.scene.camera.position.toArray());
    await first.waitForTimeout(400);
    const still = await first.evaluate(() => window.sdpUnified.scene.camera.position.toArray());
    expect(Math.hypot(stopped[0] - still[0], stopped[2] - still[2])).toBeLessThan(.02);
    await first.keyboard.up('KeyS'); room.setPatchRate(50);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.player.synchronized)).toBe(true);
    // Reach is from the edge of the 3.2m tabletop, not a tiny point at its centre.
    place(ambientStation.x + 3.8, ambientStation.z);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.scene.camera.position.x)).toBeCloseTo(ambientStation.x + 3.8, 1);
    await first.evaluate(() => {
      const app = window.sdpUnified, s = app.network.snapshot!, p = s.players.find(p => p.playerId === s.localPlayerId)!;
      app.player.setSpawn({ ...p, yaw: Math.PI / 2, pitch: -.28 });
    });
    await expect(first.locator('.instrument-interaction')).toBeVisible();
    await first.keyboard.press('KeyE'); await expect(panel).toBeVisible();
    await first.keyboard.press('Escape'); await expect(panel).toBeHidden();
    // Reproduce an out-of-date visible location just before the server rejects E.
    place(ambientStation.x + 12, ambientStation.z);
    await first.evaluate(config => {
      const app = window.sdpUnified, s = app.network.snapshot!, p = s.players.find(p => p.playerId === s.localPlayerId)!;
      const original = app.player.reconcile.bind(app.player);
      Object.assign(window, { restoreKeyboardReconciliation: () => app.player.reconcile = original });
      app.player.reconcile = () => {};
      app.player.setSpawn({ ...p, x: config.x, z: config.z + 2.2, yaw: 0, pitch: -.3 });
    }, ambientStation);
    await expect(first.locator('.instrument-interaction')).toBeVisible();
    await first.keyboard.press('KeyE');
    await expect(first.locator('.ui-notice')).toContainText('Move closer');
    await expect.poll(() => first.evaluate(() => window.sdpUnified.scene.camera.position.x)).toBeCloseTo(ambientStation.x + 12, 1);
    await expect(panel).toBeHidden();
    await first.evaluate(() => (window as unknown as { restoreKeyboardReconciliation(): void }).restoreKeyboardReconciliation());
    expect(await first.evaluate(() => window.sdpUnified.network.snapshot!.localPlayerId)).toBe(identity.id);
    expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); }
});

test('two browsers recover divergent lobby positions, reserve a real seat, then idle eviction stops reconnecting', async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext();
  const first = await a.newPage(), second = await b.newPage(), errors: string[] = [];
  try {
    for (const [page, name] of [[first, 'Position check'], [second, 'Witness']] as const) {
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${url}/?debugMode=limbo`); await enterExhibition(page, name);
    }
    const roomId = await first.evaluate(() => window.sdpUnified.network.snapshot!.roomId);
    const id = await first.evaluate(() => window.sdpUnified.network.snapshot!.localPlayerId);
    const local = fixture.room(roomId) as unknown as SDPLobby;
    const seatIndex = 0, seat = lobbySeatSlots[seatIndex], player = local.state.players.get(id)!;
    player.x = seat.x - 1.5; player.z = seat.z; player.y = seat.groundY + 1.8;
    (local as unknown as { simulation: MovementSimulation }).simulation.add(id, { x: player.x, z: player.z, groundY: seat.groundY });
    await first.bringToFront();
    if (await first.getByRole('button', { name: 'RESUME', exact: true }).isVisible()) await first.getByRole('button', { name: 'RESUME', exact: true }).click();
    await first.evaluate(() => {
      const app = window.sdpUnified, s = app.network.snapshot!, local = s.players.find(p => p.playerId === s.localPlayerId)!;
      app.player.setSpawn({ ...local, x: local.x + 9, yaw: -Math.PI / 2, pitch: -.65 });
    });
    await expect.poll(() => first.evaluate(() => {
      const app = window.sdpUnified, s = app.network.snapshot!, p = s.players.find(p => p.playerId === s.localPlayerId)!;
      return Math.hypot(app.scene.camera.position.x - p.x, app.scene.camera.position.z - p.z);
    })).toBeLessThan(.15);
    await expect.poll(() => second.evaluate(id => {
      const app = window.sdpUnified, s = app.network.snapshot!, p = s.players.find(p => p.playerId === id)!;
      return p.x;
    }, id)).toBeCloseTo(player.x, 1);
    await expect(first.getByRole('button', { name: 'Sit on bench', exact: true })).toBeVisible();
    await first.keyboard.press('KeyE'); await expect.poll(() => local.state.players.get(id)!.seatIndex).toBe(seatIndex);
    await expect.poll(() => second.evaluate(id => window.sdpUnified.network.snapshot!.players.find(p => p.playerId === id)?.seatIndex, id)).toBe(seatIndex);
    await first.keyboard.press('KeyE'); await expect.poll(() => local.state.players.get(id)!.seatIndex).toBe(-1);
    local.clock.elapsedTime = sessionPolicy.idleMs + 20000;
    const tracker = (local as unknown as { inactivity: RoomInactivity }).inactivity;
    for (const peer of local.clients) if (peer.sessionId !== id) tracker.touch(peer.sessionId);
    tracker.check();
    await expect(first.getByRole('alertdialog', { name: 'SESSION DISCONNECTED' })).toBeVisible();
    await expect(first.getByRole('button', { name: 'REJOIN', exact: true })).toBeVisible();
    await expect.poll(() => local.state.players.has(id)).toBe(false);
    await first.evaluate(() => window.sdpUnified.network.connect());
    const transitionRejected = await first.evaluate(async () => {
      try { await window.sdpUnified.network.switchRoom('SDPShooterRoom'); return false; }
      catch { return true; }
    });
    expect(transitionRejected).toBe(true);
    await first.waitForTimeout(2500);
    expect(await first.evaluate(() => window.sdpUnified.network.status)).toMatchObject({ state: 'disconnected', reason: 'inactive' });
    expect(local.state.online).toBe(1); expect(errors).toEqual([]);
    await first.screenshot({ path: '/private/tmp/sdp-session-idle.png' });
  } finally { await a.close(); await b.close(); }
});

test('next round countdown is prominent on desktop and mobile and a real server round restarts', async ({ browser }) => {
  const context = await browser.newContext(), page = await context.newPage();
  try {
    await page.goto(`${url}/?debugMode=shooter`);
    await expect(page.locator('#app')).toHaveAttribute('data-mode', 'SHOOTER', { timeout: 90000 });
    await page.getByRole('button', { name: 'ENTER SIMULATION' }).click();
    const roomId = await page.evaluate(() => window.sdpUnified.network.snapshot!.roomId), local = fixture.room(roomId);
    local.clock.elapsedTime = local.state.matchEndsAt;
    const tracker = (local as unknown as { inactivity: RoomInactivity }).inactivity;
    for (const client of local.clients) tracker.touch(client.sessionId);
    await expect(page.locator('.round-restart')).toBeVisible();
    await expect(page.locator('.round-countdown')).toHaveText(/[1-8]s/);
    expect(await page.locator('.round-countdown').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(32);
    await page.screenshot({ path: '/private/tmp/sdp-next-round-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    const box = (await page.locator('.round-restart').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: '/private/tmp/sdp-next-round-mobile.png' });
    const round = local.state.round; local.clock.elapsedTime = local.state.nextRoundAt + 1;
    await expect.poll(() => local.state.round).toBe(round + 1);
    await expect(page.locator('.round-restart')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter!.paused)).toBe(false);
    await expect(page.locator('.mode-overlay')).toBeHidden();
    const before = await page.evaluate(() => window.sdpUnified.modes.shooter!.snapshot.position!);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(700); await page.keyboard.up('KeyW');
    const after = await page.evaluate(() => window.sdpUnified.modes.shooter!.snapshot.position!);
    expect(Math.hypot(after[0] - before[0], after[2] - before[2])).toBeGreaterThan(.2);
    // Repeat a complete result/restart cycle: no stale pause overlay or controls.
    local.clock.elapsedTime = local.state.matchEndsAt;
    for (const client of local.clients) tracker.touch(client.sessionId);
    await expect(page.locator('.round-restart')).toBeVisible();
    const secondRound = local.state.round; local.clock.elapsedTime = local.state.nextRoundAt + 1;
    await expect.poll(() => local.state.round).toBe(secondRound + 1);
    await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter!.paused)).toBe(false);
    await expect(page.locator('.mode-overlay')).toBeHidden();
  } finally { await context.close(); }
});

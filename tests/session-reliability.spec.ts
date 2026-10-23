import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { createServer as netServer } from 'node:net';
import { shooterFixture } from '../server/tests/shooter-fixture';
import type { SDPLobby } from '../server/src/rooms/SDPLobby';
import type { MovementSimulation } from '../server/src/simulation/MovementSimulation';
import type { RoomInactivity } from '../server/src/communication/RoomInactivity';
import { lobbySeatSlots } from '../shared/LobbyRetreat';
import { sessionPolicy } from '../shared/SessionPolicy';
import { enterExhibition, submitName } from './entry';
import { admission } from '../server/src/communication/Admission';
import { ambientStation } from '../shared/AmbientStation';
import { lowerGallery, galleryListening } from '../shared/LowerGallery';

let fixture: Awaited<ReturnType<typeof shooterFixture>>, vite: ViteDevServer, url: string;
test.beforeAll(async () => {
  fixture = await shooterFixture();
  const server = netServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve()));
  Object.assign(process.env, { SDP_BACKEND_PORT: String(fixture.port), SDP_WEB_PORT: String(port), VITE_SDP_SERVER_URL: '/multiplayer' });
  vite = await createServer({ root: process.cwd(), mode: 'unified', server: { host: '127.0.0.1', port, strictPort: true } });
  await vite.listen(); url = `http://127.0.0.1:${port}`;
});
test.afterAll(async () => { await vite?.close(); await fixture?.server.gracefullyShutdown(false); });

test('invitation controls and slash completion fit desktop and mobile without loading Shooter', async ({ browser }) => {
  for (const viewport of [{ width: 1200, height: 800 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const mobile = viewport.width < 900, context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile }), page = await context.newPage();
    const shooter: string[] = []; page.on('request', request => { if (/shooter|ShooterMode/.test(request.url())) shooter.push(request.url()); });
    try {
      await page.route('**/social-ui-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/styles/main.css"><link rel="stylesheet" href="/src/styles/touch.css"><main id="app" data-mode="LIMBO" data-input="${mobile ? 'touch' : 'mouse'}"><div class="ui" data-state="CHATTING"></div></main>` }));
      await page.goto(`${url}/social-ui-fixture`);
      await page.evaluate(async () => {
        const path = '/src/ui/ChatInterface.ts', { ChatInterface } = await import(path);
        const chat = new ChatInterface(document.querySelector('.ui')!, () => {}, () => {});
        Object.assign(window, { socialUI: chat, acceptedInvite: false });
        chat.configureInvitations(async () => { (window as any).acceptedInvite = true; }, () => {}); chat.setOpen(true);
        chat.invite({ id: 'test', fromId: 'a', fromSessionId: 'a', fromName: 'A Long Visitor Name', roomId: 'test-room', mode: 'SHOOTER', expiresAt: Date.now() + 45000 });
      });
      await page.getByRole('textbox', { name: 'Chat message' }).fill('/');
      await expect(page.getByRole('textbox', { name: 'Chat message' })).toHaveValue('/invite ');
      await expect(page.locator('.chat-command')).toBeVisible();
      await page.evaluate(() => (window as any).socialUI.setOpen(false));
      const tray = page.getByRole('region', { name: 'Room invitations' }); await expect(tray).toBeVisible();
      const box = await tray.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      expect(await tray.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({ path: `/private/tmp/sdp-invitation-ui-${viewport.width}.png` });
      await page.getByRole('button', { name: 'ACCEPT', exact: true }).click();
      await expect(tray).toBeHidden(); expect(await page.evaluate(() => (window as any).acceptedInvite)).toBe(true); expect(shooter).toEqual([]);
    } finally { await context.close(); }
  }
});

test('duplicate global username stays on the name form and can be corrected without a reload', async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext();
  const first = await a.newPage(), second = await b.newPage();
  try {
    await first.goto(`${url}/?debugMode=limbo`); await enterExhibition(first, 'Unique Friend');
    await second.goto(`${url}/?debugMode=limbo`); await submitName(second, 'unique FRIEND');
    await expect(second.locator('.intro-name-message')).toContainText('already in use');
    await expect(second.getByRole('textbox', { name: 'USERNAME', exact: true })).toBeEnabled();
    let failOnce = true;
    await second.route('**/matchmake/joinOrCreate/SDPAdmission', async route => {
      if (failOnce) { failOnce = false; await route.abort(); } else await route.continue();
    });
    await second.getByRole('button', { name: 'ENTER', exact: true }).click();
    await expect(second.locator('.intro-name-message')).toContainText('already in use');
    await expect(second.getByRole('textbox', { name: 'USERNAME', exact: true })).toBeEnabled();
    await second.getByRole('textbox', { name: 'USERNAME', exact: true }).fill('Another Friend');
    await second.getByRole('button', { name: 'ENTER', exact: true }).click();
    await expect(second.locator('.connection-indicator')).toHaveAttribute('data-connection', 'connected');
    await expect(second.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  } finally {
    for (const page of [first, second]) await page.evaluate(() => window.sdpUnified?.network.disconnect()).catch(() => {});
    await a.close(); await b.close(); admission.tick(Date.now() + 121000);
  }
});

test('two browsers accept chat invitations across all four Limbo and Shooter routes', async ({ browser }) => {
  test.setTimeout(300000);
  const a = await browser.newContext({ viewport: { width: 960, height: 640 } }), b = await browser.newContext({ viewport: { width: 960, height: 640 } }), first = await a.newPage(), second = await b.newPage(), errors: string[] = [];
  const openChat = async (page: typeof first) => {
    await page.bringToFront();
    if (await page.locator('#app').getAttribute('data-mode') === 'LIMBO') {
      if (await page.locator('.resume-button').isVisible()) await page.locator('.resume-button').click();
      await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
    } else {
      const resume = page.getByRole('button', { name: /^(RESUME|ENTER SIMULATION)$/ });
      if (await resume.isVisible()) await resume.click();
      await expect(page.locator('.mode-overlay')).toBeHidden();
    }
    await page.keyboard.press('Enter'); await expect(page.getByRole('textbox', { name: 'Chat message' })).toBeVisible();
  };
  const invite = async (sender: typeof first, recipient: typeof first, name: string, label: string) => {
    console.info('Invitation route:', label);
    await openChat(sender);
    const input = sender.getByRole('textbox', { name: 'Chat message' });
    await input.fill('/'); await expect(input).toHaveValue('/invite ');
    await expect(sender.locator('.chat-command')).toBeVisible();
    await input.fill(`/invite ${name}`); await input.press('Enter');
    await expect(recipient.getByRole('region', { name: 'Room invitations' })).toBeVisible();
    await openChat(recipient);
    await recipient.getByRole('button', { name: 'ACCEPT', exact: true }).click();
    await expect(recipient.locator('.chat-invitations')).toBeHidden({ timeout: 90000 });
    const target = await sender.evaluate(() => window.sdpUnified.network.snapshot!.roomId);
    await expect.poll(() => recipient.evaluate(() => window.sdpUnified.network.snapshot!.roomId)).toBe(target);
    await expect(recipient.locator('.connection-indicator')).toHaveAttribute('data-connection', 'connected');
    await recipient.screenshot({ path: `/private/tmp/sdp-invite-${label}.png` });
    console.info('Invitation route passed:', label);
  };
  try {
    for (const page of [first, second]) page.on('pageerror', error => errors.push(error.message));
    await first.goto(`${url}/?debugMode=limbo`); await enterExhibition(first, 'Invite Alice');
    const lobby = fixture.room(await first.evaluate(() => window.sdpUnified.network.snapshot!.roomId)); await lobby.lock();
    await second.goto(`${url}/?debugMode=limbo`); await enterExhibition(second, 'Invite Bob');
    await lobby.unlock();
    await invite(first, second, 'Invite Bob', 'limbo-limbo');
    await first.bringToFront();
    await first.evaluate(() => window.sdpUnified.modes.joinShooter());
    await expect(first.locator('#app')).toHaveAttribute('data-mode', 'SHOOTER', { timeout: 90000 });
    await invite(first, second, 'Invite Bob', 'limbo-shooter');
    const shooter = fixture.room(await first.evaluate(() => window.sdpUnified.network.snapshot!.roomId)); await shooter.lock();
    await second.evaluate(() => window.sdpUnified.network.switchRoom('SDPShooterRoom')); await shooter.unlock();
    await invite(second, first, 'Invite Alice', 'shooter-shooter');
    await first.evaluate(() => window.sdpUnified.modes.returnToLimbo());
    await expect(first.locator('#app')).toHaveAttribute('data-mode', 'LIMBO');
    await invite(first, second, 'Invite Bob', 'shooter-limbo');
    expect(errors).toEqual([]);
    for (const page of [first, second]) await expect(page.locator('canvas.scene-canvas')).toHaveCount(1);
  } finally {
    for (const page of [first, second]) await page.evaluate(() => window.sdpUnified?.network.disconnect()).catch(() => {});
    await a.close(); await b.close(); admission.tick(Date.now() + 121000);
  }
});

test('expired and malformed reconnect reservations fall back to admission without losing the visit', async ({ browser }) => {
  admission.enabled = true; admission.capacity = 1;
  const context = await browser.newContext({ permissions: ['local-network-access'] }), page = await context.newPage();
  try {
    await page.route('**/reconnect-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Reconnect test</title>' }));
    await page.goto(`${url}/reconnect-fixture`);
    await page.evaluate(async () => {
      const path = '/src/network/ColyseusNetworkAdapter.ts';
      const { ColyseusNetworkAdapter } = await import(path);
      (window as any).reconnectTest = new ColyseusNetworkAdapter();
      await (window as any).reconnectTest.connect();
    });
    await expect.poll(() => page.evaluate(() => (window as any).reconnectTest.status.state)).toBe('connected');
    const original = await page.evaluate(() => ({ room: (window as any).reconnectTest.snapshot.roomId, visit: sessionStorage.getItem('sdp:admission') }));
    const room = fixture.room(original.room) as unknown as SDPLobby;
    room.autoDispose = false;
    try {
      for (const token of [`${original.room}:expired-test-token`, 'malformed-token', 'missing-room:expired-test-token']) {
        await page.evaluate(async token => {
          const network = (window as any).reconnectTest;
          await network.leaveRoom();
          sessionStorage.setItem('sdp:reconnect', JSON.stringify({ token, type: network.roomType, expires: Date.now() + 120000 }));
          await network.connect();
        }, token);
        await expect.poll(() => page.evaluate(() => (window as any).reconnectTest.status.state), { timeout: 6000 }).toBe('connected');
        expect(await page.evaluate(() => sessionStorage.getItem('sdp:admission'))).toBe(original.visit);
        expect(await page.evaluate(() => (window as any).reconnectTest.snapshot.players.filter((p: any) => p.connected).length)).toBe(1);
      }
    } finally {
      await page.evaluate(() => (window as any).reconnectTest.leaveRoom()).catch(() => {});
      await expect.poll(() => room.state.online).toBe(0);
      room.autoDispose = true;
    }
  } finally {
    await page.evaluate(async () => { const network = (window as any).reconnectTest; if (network) { await network.leaveRoom(); network.disconnect(); } }).catch(() => {});
    await context.close(); admission.tick(Date.now() + 121000); admission.enabled = false; admission.capacity = 25;
  }
});

test('REJOIN after real idle eviction reloads and reconnects in Limbo and Shooter', async ({ browser }) => {
  for (const mode of ['limbo', 'shooter']) {
    const context = await browser.newContext(), page = await context.newPage();
    try {
      await page.goto(`${url}/?debugMode=${mode}`, { waitUntil: 'domcontentloaded' });
      if (mode === 'limbo') {
        await submitName(page, 'Idle visitor');
        await expect(page.locator('.ui')).toHaveAttribute('data-state', /^(EXPLORING|PAUSED)$/);
        await expect(page.locator('.connection-indicator')).toHaveAttribute('data-connection', 'connected');
      }
      else {
        await expect(page.locator('#app')).toHaveAttribute('data-mode', 'SHOOTER', { timeout: 90000 });
        await page.getByRole('button', { name: 'ENTER SIMULATION' }).click();
      }
      const identity = await page.evaluate(() => ({ room: window.sdpUnified.network.snapshot!.roomId, id: window.sdpUnified.network.snapshot!.localPlayerId }));
      const room = fixture.room(identity.room);
      (room as unknown as { inactivity: RoomInactivity }).inactivity.check(room.clock.elapsedTime + sessionPolicy.idleMs + 1000);
      await expect(page.getByRole('alertdialog', { name: 'SESSION DISCONNECTED' })).toBeVisible();
      await expect.poll(() => room.state.players.has(identity.id)).toBe(false);
      await page.getByRole('button', { name: 'REJOIN', exact: true }).click();
      if (mode === 'limbo') {
        await submitName(page, 'Idle visitor');
        await expect(page.locator('.ui')).toHaveAttribute('data-state', /^(EXPLORING|PAUSED)$/);
      }
      else {
        await expect(page.locator('#app')).toHaveAttribute('data-mode', 'SHOOTER', { timeout: 90000 });
        await page.getByRole('button', { name: 'ENTER SIMULATION' }).click();
      }
      await expect(page.locator('.connection-indicator')).toHaveAttribute('data-connection', 'connected');
      await expect(page.locator('.session-idle-overlay')).toBeHidden();
      expect(await page.evaluate(() => window.sdpUnified.network.snapshot!.localPlayerId)).not.toBe(identity.id);
    } finally {
      await page.evaluate(() => window.sdpUnified?.network.disconnect()).catch(() => {});
      await context.close(); admission.tick(Date.now() + 121000);
    }
  }
});

test('Limbo and Shooter recover connection cuts and automatically replace expired live reservations', async ({ browser }) => {
  for (const type of ['SDPLimboRoom', 'SDPShooterRoom']) {
    const context = await browser.newContext({ permissions: ['local-network-access'] }), page = await context.newPage();
    let room: ReturnType<typeof fixture.room> | undefined;
    try {
      await page.route('**/connection-cut-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Connection cut test</title>' }));
      await page.goto(`${url}/connection-cut-fixture`);
      await page.evaluate(async type => {
        const path = '/src/network/ColyseusNetworkAdapter.ts';
        const { ColyseusNetworkAdapter } = await import(path);
        const network = (window as any).reconnectTest = new ColyseusNetworkAdapter();
        network.roomType = type; await network.connect();
      }, type);
      await expect.poll(() => page.evaluate(() => (window as any).reconnectTest.status.state)).toBe('connected');
      const original = await page.evaluate(() => ({ room: (window as any).reconnectTest.snapshot.roomId, id: (window as any).reconnectTest.snapshot.localPlayerId }));
      room = fixture.room(original.room); room.autoDispose = false;
      for (const expire of [false, true]) {
        await context.setOffline(true);
        // Close the actual transport to reproduce a network loss deterministically.
        (room.clients.find(client => client.sessionId === original.id)!.ref as unknown as { close(code: number, reason: string): void }).close(4010, 'Connection test');
        await expect.poll(() => page.evaluate(() => (window as any).reconnectTest.status.reason)).toBe('reconnecting');
        if (expire) {
          const pending = (room as unknown as { _reconnections: Record<string, [string, { reject(error: Error): void }]> })._reconnections;
          await expect.poll(() => Object.values(pending).some(([id]) => id === original.id)).toBe(true);
          Object.values(pending).find(([id]) => id === original.id)![1].reject(new Error('Test reservation expired'));
          await expect.poll(() => room!.state.players.has(original.id)).toBe(false);
        }
        await context.setOffline(false);
        await expect.poll(() => page.evaluate(() => (window as any).reconnectTest.status.state)).toBe('connected');
        const current = await page.evaluate(() => (window as any).reconnectTest.snapshot.localPlayerId);
        if (expire) expect(current).not.toBe(original.id); else expect(current).toBe(original.id);
      }
    } finally {
      await context.setOffline(false);
      await page.evaluate(async () => { const network = (window as any).reconnectTest; if (network) { await network.leaveRoom(); network.disconnect(); } }).catch(() => {});
      if (room) await expect.poll(() => room!.state.online).toBe(0);
      if (room) room.autoDispose = true;
      await context.close(); admission.tick(Date.now() + 121000);
    }
  }
});

test('disconnect screen is opaque, centered and keyboard-modal in both modes on desktop and mobile', async ({ browser }) => {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    try {
      await page.clock.install();
      await page.route('**/session-overlay-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="stylesheet" href="/src/styles/main.css"><link rel="stylesheet" href="/src/styles/modes.css"><link rel="stylesheet" href="/src/styles/touch.css"></head><body><main id="app" data-input="${mobile ? 'touch' : 'mouse'}" style="background:#000;min-height:100vh"><button id="background-button">Background</button></main></body></html>` }));
      await page.goto(`${url}/session-overlay-fixture`);
      await page.evaluate(async () => {
        const modulePath = '/src/network/SessionActivity.ts';
        const { SessionActivity } = await import(modulePath);
        const fixture = { status: { state: 'connected', online: 1, capacity: 25, roomId: 'fixture', reason: undefined as string | undefined }, listeners: [] as ((s: unknown) => void)[], interrupted: 0, inactive: 0, keys: 0,
          subscribeToStatus(cb: (s: unknown) => void) { this.listeners.push(cb); cb(this.status); return () => {}; }, sendActivity() {},
          emit(state: string, reason?: string) { this.status = { ...this.status, state, reason }; for (const cb of this.listeners) cb(this.status); } };
        const activity = new SessionActivity(document.getElementById('app')!, fixture, () => fixture.inactive++, () => fixture.interrupted++);
        window.addEventListener('keydown', () => fixture.keys++);
        Object.assign(window, { disconnectFixture: fixture, disconnectActivity: activity });
      });
      for (const mode of ['LIMBO', 'SHOOTER']) {
        await page.evaluate(mode => {
          document.getElementById('app')!.dataset.mode = mode;
          (window as any).disconnectFixture.emit('connecting', 'reconnecting');
        }, mode);
        const dialog = page.getByRole('alertdialog', { name: 'CONNECTION INTERRUPTED' });
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveCSS('background-color', 'rgb(248, 251, 253)');
        await expect(dialog.locator('.session-reservation')).toContainText('2:00');
        expect(await page.locator('#background-button').evaluate(element => (element as HTMLElement).inert)).toBe(true);
        await page.keyboard.press('p');
        expect(await page.evaluate(() => (window as any).disconnectFixture.keys)).toBe(0);
        await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: 'RELOAD SESSION' })).toBeFocused();
        await page.screenshot({ path: `/private/tmp/sdp-disconnected-${mode.toLowerCase()}-${mobile ? 'mobile' : 'desktop'}.png` });
        await page.clock.fastForward(121000);
        await expect(dialog.locator('.session-reservation')).toContainText('RESERVATION ENDED');
        await expect(dialog.locator('.session-disconnect-message')).toContainText('expired');
        await page.evaluate(() => (window as any).disconnectFixture.emit('connected'));
        await expect(dialog).toBeHidden();
        expect(await page.locator('#background-button').evaluate(element => (element as HTMLElement).inert)).toBe(false);
      }
      await page.evaluate(() => (window as any).disconnectFixture.emit('disconnected', 'inactive'));
      const idle = page.getByRole('alertdialog', { name: 'SESSION DISCONNECTED' });
      await expect(idle).toBeVisible(); await expect(idle).toContainText('5 minutes of inactivity');
      await expect(idle.getByRole('button', { name: 'REJOIN' })).toBeFocused();
      await expect(idle.locator('.session-reservation')).toBeHidden();
      await page.screenshot({ path: `/private/tmp/sdp-inactive-${mobile ? 'mobile' : 'desktop'}.png` });
      await page.evaluate(() => (window as any).disconnectFixture.emit('connected'));
      await expect(idle).toBeVisible();
    } finally { await context.close(); }
  }
});

test('entry queue: loading bar, mobile waiting position, reload reservation and automatic admission', async ({ browser }) => {
  admission.enabled = true; admission.capacity = 1;
  const desktop = await browser.newContext(), mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const first = await desktop.newPage(), second = await mobile.newPage(), errors: string[] = [];
  try {
    for (const page of [first, second]) page.on('pageerror', error => errors.push(error.message));
    await first.route('**/SDP/SDPv1.glb', async route => { await new Promise(resolve => setTimeout(resolve, 2000)); await route.continue(); });
    await first.goto(`${url}/?debugMode=limbo`, { waitUntil: 'domcontentloaded' });
    await expect(first.locator('.intro-loading')).toBeVisible();
    await first.screenshot({ path: '/private/tmp/sdp-entry-loading.png' });
    await enterExhibition(first, 'Reserved browser');
    const original = await first.evaluate(() => ({ id: window.sdpUnified.network.snapshot!.localPlayerId, room: window.sdpUnified.network.snapshot!.roomId }));
    await second.goto(`${url}/?debugMode=limbo`); await submitName(second, 'Waiting browser');
    await expect(second.locator('.intro-loading')).toContainText('1 IN QUEUE');
    await second.screenshot({ path: '/private/tmp/sdp-entry-queue-mobile.png' });
    await desktop.setOffline(true);
    await expect(first.locator('.connection-indicator')).toHaveAttribute('data-connection', 'connecting');
    await new Promise(resolve => setTimeout(resolve, 7000));
    await desktop.setOffline(false);
    await expect(first.locator('.connection-indicator')).toHaveAttribute('data-connection', 'connected');
    expect(await first.evaluate(() => window.sdpUnified.network.snapshot!.localPlayerId)).toBe(original.id);
    await expect(second.locator('.intro-loading')).toContainText('1 IN QUEUE');
    await first.reload(); await enterExhibition(first, 'Reserved browser');
    expect(await first.evaluate(() => ({ id: window.sdpUnified.network.snapshot!.localPlayerId, room: window.sdpUnified.network.snapshot!.roomId }))).toEqual(original);
    await expect(second.locator('.intro-loading')).toContainText('1 IN QUEUE');
    await first.evaluate(() => window.sdpUnified.network.leaveRoom());
    admission.tick(Date.now() + 30001);
    await expect(second.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
    await expect(second.locator('.connection-indicator')).toHaveAttribute('data-connection', 'connected');
    expect(errors).toEqual([]);
  } finally {
    for (const page of [first, second]) await page.evaluate(() => window.sdpUnified?.network.disconnect()).catch(() => {});
    await desktop.close(); await mobile.close(); admission.enabled = false; admission.capacity = 25;
  }
});

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
    local.clock.elapsedTime += sessionPolicy.idleMs + 20000;
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

test('three Shooter round trips preserve the waiting lobby, release empty rooms and keep one renderer', async ({ browser }) => {
  const visitor = await browser.newContext(), waiting = await browser.newContext();
  const first = await visitor.newPage(), second = await waiting.newPage(), errors: string[] = [];
  try {
    for (const [page, name] of [[first, 'Travelling visitor'], [second, 'Waiting visitor']] as const) {
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${url}/?debugMode=limbo`); await enterExhibition(page, name);
    }
    const lobbyId = await second.evaluate(() => window.sdpUnified.network.snapshot!.roomId);
    for (let cycle = 0; cycle < 3; cycle++) {
      await first.evaluate(() => window.sdpUnified.modes.joinShooter());
      await expect(first.locator('#app')).toHaveAttribute('data-mode', 'SHOOTER');
      const shooterId = await first.evaluate(() => window.sdpUnified.network.snapshot!.roomId);
      expect(shooterId).not.toBe(lobbyId);
      await expect.poll(() => second.evaluate(() => window.sdpUnified.network.snapshot!.players.filter(p => p.connected).length)).toBe(1);
      await expect(first.locator('canvas.scene-canvas')).toHaveCount(1);
      await first.getByRole('button', { name: 'ENTER SIMULATION' }).click();
      await expect(first.locator('.mode-overlay')).toBeHidden();
      await first.evaluate(() => window.sdpUnified.modes.returnToLimbo());
      await expect(first.locator('#app')).toHaveAttribute('data-mode', 'LIMBO');
      await expect(first.locator('.connection-indicator')).toHaveAttribute('data-connection', 'connected');
      expect(await first.evaluate(() => window.sdpUnified.network.snapshot!.roomId)).toBe(lobbyId);
      await expect.poll(() => second.evaluate(() => window.sdpUnified.network.snapshot!.players.filter(p => p.connected).length)).toBe(2);
      await expect.poll(() => Boolean(fixture.room(shooterId))).toBe(false);
      await expect(first.locator('canvas.scene-canvas')).toHaveCount(1);
    }
    expect(errors).toEqual([]);
  } finally {
    for (const page of [first, second]) await page.evaluate(() => window.sdpUnified?.network.disconnect()).catch(() => {});
    await visitor.close(); await waiting.close();
  }
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

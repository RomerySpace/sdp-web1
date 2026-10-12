import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import type { GameModeManager } from '../src/modes/GameModeManager';
import type { ColyseusNetworkAdapter } from '../src/network/ColyseusNetworkAdapter';
import type { SceneManager } from '../src/scene/SceneManager';
import type { FirstPersonController } from '../src/player/FirstPersonController';
import type { LiveKitVoiceTransport } from '../src/audio/LiveKitVoiceTransport';
import type { ShooterMode } from '../src/modes/shooter/ShooterMode';
declare global { interface Window {
  sdpUnified: { modes: GameModeManager; network: ColyseusNetworkAdapter; scene: SceneManager; player: FirstPersonController; voiceTransport: LiveKitVoiceTransport };
  retiredShooter?: ShooterMode;
  audioContexts: number;
  createdAudioContexts: AudioContext[];
  shooterMotionSamples: { time: number; x: number; y: number; z: number }[];
} }
const shooterRequest = (url: string): boolean => /\/shooter\/|\/modes\/shooter\/|ShooterMode-|shooter-physics-|rapier3d/.test(url);
async function enterLimbo(page: Page): Promise<void> {
  await page.goto('/?debugMode=limbo');
  await expect(page.locator('.ui')).toHaveAttribute('data-sculpture', 'loaded');
  await expect(page.locator('.connection-indicator')).toHaveAttribute('data-connection', 'connected');
  await page.getByRole('button', { name: 'CLICK TO ENTER' }).click();
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
}
async function openProtocol(page: Page): Promise<void> {
  await page.evaluate(() => { const camera = window.sdpUnified.player.camera; camera.position.set(0, 1.7, 2.7); camera.rotation.set(0, 0, 0); });
  await expect(page.getByRole('button', { name: 'Interact with sculpture' })).toBeVisible();
  await page.keyboard.press('KeyE');
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'INSPECTING');
  await expect(page.locator('.mode-overlay')).toBeHidden();
}
async function enterShooter(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'JOIN SHOOTER TEST', exact: true }).click();
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'SHOOTER');
  await page.getByRole('button', { name: 'ENTER SIMULATION' }).click();
  await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter?.paused)).toBe(false);
}
async function visiblePixels(page: Page): Promise<number> {
  const { data, info } = await sharp(await page.locator('canvas').screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let contrast = 0;
  for (let i = 0; i < data.length; i += info.channels) if (Math.min(data[i], data[i + 1], data[i + 2]) < 210) contrast++;
  return contrast;
}
test('two actual browsers: authoritative hits, crouch, digital death and server respawn', async ({ browser }, info) => {
  const a = await browser.newContext(), b = await browser.newContext(), first = await a.newPage(), second = await b.newPage();
  const errors: string[] = [];
  for (const page of [first, second]) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /THREE|shader|WebGL/i.test(message.text())) errors.push(message.text()); });
  }
  const targetState = () => second.evaluate(() => { const s = window.sdpUnified.network.snapshot!; return s.players.find(p => p.playerId === s.localPlayerId)!; });
  try {
    await enterLimbo(first); await openProtocol(first); await enterShooter(first);
    await enterLimbo(second); await openProtocol(second); await enterShooter(second);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.modes.shooter!.remotes.count)).toBe(1);
    await second.keyboard.down('ControlLeft');
    await expect.poll(async () => (await targetState()).height).toBeLessThan(1.3);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.modes.shooter!.remotes.group.children[0].userData.height)).toBeLessThan(1.3);
    expect(await first.evaluate(() => window.sdpUnified.modes.shooter!.remotes.group.children[0].scale.y)).toBe(1);
    await second.keyboard.up('ControlLeft'); await expect.poll(async () => (await targetState()).height).toBeGreaterThan(1.7);
    await first.bringToFront(); if (await first.getByRole('button', { name: 'RESUME', exact: true }).isVisible()) await first.getByRole('button', { name: 'RESUME', exact: true }).click();
    await expect.poll(() => first.evaluate(() => window.sdpUnified.modes.shooter!.input.enabled && window.sdpUnified.modes.shooter!.input.locked)).toBe(true);
    await expect.poll(() => second.evaluate(() => { const s = window.sdpUnified.network.snapshot!, p = s.players.find(p => p.playerId === s.localPlayerId)!; return s.serverTime! - p.protectedUntil!; })).toBeGreaterThan(200);
    await first.evaluate(() => {
      const app = window.sdpUnified, s = app.network.snapshot!, own = s.players.find(p => p.playerId === s.localPlayerId)!, other = s.players.find(p => p.playerId !== s.localPlayerId)!;
      const game = app.modes.shooter!, dx = other.x - own.x, dz = other.z - own.z;
      game.input.yaw = Math.atan2(-dx, -dz); game.input.pitch = Math.atan2(other.y + other.height! * .58 - (own.y + own.height! - .1), Math.hypot(dx, dz));
    });
    await first.waitForTimeout(300);
    await first.mouse.down(); await first.mouse.up();
    await expect.poll(async () => (await targetState()).health).toBe(50);
    await expect.poll(() => second.evaluate(() => window.sdpUnified.modes.shooter!.health)).toBe(50);
    await expect.poll(() => second.locator('.damage-vignette').evaluate(node => Number(getComputedStyle(node).opacity))).toBeGreaterThan(0);
    await second.screenshot({ path: info.outputPath('white-digital-damage.png') });
    await first.mouse.down(); await first.mouse.up();
    await expect.poll(async () => (await targetState()).dead).toBe(true);
    const dead = await targetState(); const steps = await second.evaluate(() => window.sdpUnified.modes.shooter!.fixedSteps);
    await expect(second.locator('.desynchronization-state')).toBeVisible(); await expect(first.locator('.combat-confirmation')).toBeVisible();
    await expect.poll(() => first.evaluate(() => window.sdpUnified.modes.shooter!.remotes.group.children[0].userData.coherence)).toBeLessThan(.95);
    await first.screenshot({ path: info.outputPath('avatar-desynchronizing.png') });
    await second.bringToFront(); await second.keyboard.down('KeyW'); await second.keyboard.press('KeyR'); await second.mouse.click(720, 500); await second.keyboard.up('KeyW');
    expect(await second.evaluate(() => window.sdpUnified.modes.shooter!.input.enabled)).toBe(false);
    expect(await second.evaluate(() => window.sdpUnified.modes.shooter!.fixedSteps)).toBe(steps);
    const stillDead = await targetState(); expect(stillDead.ammo).toBe(30); expect(stillDead.reloading).toBe(false);
    expect(Math.hypot(stillDead.x - dead.x, stillDead.z - dead.z)).toBeLessThan(.01);
    await expect.poll(async () => (await targetState()).life, { timeout: 7000 }).toBe(dead.life! + 1);
    const revived = await targetState();
    expect(revived.spawnY).toBeLessThan(1); expect(dead.spawnY).toBeLessThan(1);
    expect(revived.bornAt! - dead.diedAt!).toBeGreaterThanOrEqual(3000); expect(revived.bornAt! - dead.diedAt!).toBeLessThan(3250);
    expect(revived.health).toBe(100); expect(revived.ammo).toBe(30); expect(revived.dead).toBe(false);
    expect(revived.protectedUntil!).toBeGreaterThan(revived.bornAt!);
    expect(Math.hypot(revived.x - dead.x, revived.z - dead.z)).toBeGreaterThan(3);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.modes.shooter!.remotes.group.children[0].userData.life)).toBe(revived.life);
    expect(await first.evaluate(() => window.sdpUnified.modes.shooter!.remotes.group.children[0].userData.coherence)).toBeLessThan(1);
    await expect.poll(() => second.evaluate(() => window.sdpUnified.modes.shooter!.dead)).toBe(false);
    await expect(second.locator('.desynchronization-state')).toBeHidden();
    expect(await second.evaluate(() => Math.abs(window.sdpUnified.modes.shooter!.weapon.springs.recoil.velocity))).toBeLessThan(.001);
    await second.screenshot({ path: info.outputPath('server-respawn.png') });
    expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); }
});
test('two browsers: ground spawns, correctly aimed remote weapon and stable movement with 160ms RTT plus jitter', async ({ browser }, info) => {
  const a = await browser.newContext(), b = await browser.newContext(), first = await a.newPage(), second = await b.newPage();
  const errors: string[] = [];
  for (const page of [first, second]) page.on('pageerror', error => errors.push(error.message));
  await first.addInitScript(() => {
    // Delay real Colyseus WS delivery while preserving native protocol validation.
    window.WebSocket = new Proxy(window.WebSocket, { construct(target, args) {
      const socket = Reflect.construct(target, args) as WebSocket;
      if (!String(args[0]).includes('/multiplayer/')) return socket;
      const send = socket.send.bind(socket); let outgoing = 0, incoming = 0;
      socket.send = data => {
        const payload = data instanceof ArrayBuffer ? data.slice(0) : ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice() : data;
        outgoing = Math.max(outgoing, performance.now() + 80);
        setTimeout(() => { if (socket.readyState === WebSocket.OPEN) send(payload); }, outgoing - performance.now());
      };
      socket.addEventListener('message', event => {
        event.stopImmediatePropagation();
        const now = performance.now(), jitter = now % 1800 < 140 ? 140 : 0;
        incoming = Math.max(incoming, now + 80 + jitter);
        setTimeout(() => { if (socket.readyState === WebSocket.OPEN) socket.onmessage?.call(socket, event); }, incoming - now);
      });
      return socket;
    } });
  });
  try {
    await enterLimbo(first); await openProtocol(first); await enterShooter(first);
    await enterLimbo(second); await openProtocol(second); await enterShooter(second);
    await first.bringToFront(); if (await first.getByRole('button', { name: 'RESUME', exact: true }).isVisible()) await first.getByRole('button', { name: 'RESUME', exact: true }).click();
    expect(await first.evaluate(() => window.sdpUnified.modes.shooter!.player!.spawn.y)).toBeLessThan(1);
    await first.evaluate(() => { const input = window.sdpUnified.modes.shooter!.input; input.yaw = .7; input.pitch = .35; });
    await expect.poll(() => second.evaluate(() => {
      const game = window.sdpUnified.modes.shooter!, remote = game.remotes.group.children[0];
      if (!remote) return 0;
      remote.updateMatrixWorld(true);
      const model = remote.getObjectByName('remote-weapon-model')!, mount = remote.getObjectByName('remote-weapon-mount')!;
      const forward = game.camera.aimDirection.clone().set(0, 0, 1).transformDirection(model.matrixWorld);
      const expected = game.camera.aimDirection.clone().set(0, 0, -1).transformDirection(mount.matrixWorld);
      return forward.dot(expected);
    })).toBeGreaterThan(.999);
    await second.evaluate(() => {
      const app = window.sdpUnified, game = app.modes.shooter!, state = app.network.snapshot!;
      const own = state.players.find(p => p.playerId === state.localPlayerId)!, other = state.players.find(p => p.playerId !== state.localPlayerId)!;
      game.input.yaw = Math.atan2(-(other.x - own.x), -(other.z - own.z));
      game.input.pitch = Math.atan2(other.y + 1.15 - (own.y + 1.7), Math.hypot(other.x - own.x, other.z - own.z));
    });
    await second.waitForTimeout(150);
    await second.screenshot({ path: info.outputPath('ground-spawn-remote-weapon.png') });
    expect(await first.evaluate(() => window.sdpUnified.network.ping())).toBeGreaterThanOrEqual(150);
    await first.evaluate(() => {
      const game = window.sdpUnified.modes.shooter!; game.input.yaw = 0; game.input.pitch = 0;
      window.shooterMotionSamples = [];
      const start = performance.now();
      const sample = (now: number) => {
        const p = game.camera.root.position;
        window.shooterMotionSamples.push({ time: now, x: p.x, y: p.y, z: p.z });
        if (now - start < 5000) requestAnimationFrame(sample);
      }; requestAnimationFrame(sample);
    });
    const remoteBefore = await second.evaluate(() => window.sdpUnified.modes.shooter!.remotes.group.children[0].position.toArray());
    await first.keyboard.down('ShiftLeft'); await first.keyboard.down('KeyW'); await first.waitForTimeout(3000);
    await first.keyboard.up('KeyW'); await first.keyboard.up('ShiftLeft'); await first.waitForTimeout(2200);
    const data = await first.evaluate(() => {
      const app = window.sdpUnified, game = app.modes.shooter!, snapshot = app.network.snapshot!, local = snapshot.players.find(p => p.playerId === snapshot.localPlayerId)!;
      return { samples: window.shooterMotionSamples, network: game.snapshot.network, status: app.network.status.state,
        finalPositionError: Math.hypot(game.player!.current.x - local.x, game.player!.current.z - local.z) };
    });
    const excess = data.samples.slice(1).map((sample, index) => {
      const before = data.samples[index], dt = (sample.time - before.time) / 1000;
      return Math.hypot(sample.x - before.x, sample.z - before.z) - 6.6 * Math.min(dt, .125);
    });
    expect(data.samples.length).toBeGreaterThan(30); expect(data.status).toBe('connected');
    expect(data.finalPositionError).toBeLessThan(.8);
    expect(data.network.teleports).toBe(0); expect(Math.max(...excess)).toBeLessThan(.4);
    expect(data.network.maxSnapshotGapMs).toBeGreaterThan(90);
    expect(data.network.interpolationMs).toBeGreaterThan(70);
    const moved = await second.evaluate(before => {
      const p = window.sdpUnified.modes.shooter!.remotes.group.children[0].position;
      return Math.hypot(p.x - before[0], p.z - before[2]);
    }, remoteBefore);
    expect(moved).toBeGreaterThan(1);
    await info.attach('simulated-network-results', { body: JSON.stringify({ ...data, samples: data.samples.length,
      maximumCameraDiscontinuity: Math.max(...excess), remoteMovement: moved }, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); }
});
test('Limbo sprint is immediate, smooth and visible in authoritative movement', async ({ page }) => {
  await enterLimbo(page);
  const z0 = await page.evaluate(() => window.sdpUnified.player.camera.position.z);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(800); await page.keyboard.up('KeyW');
  const z1 = await page.evaluate(() => window.sdpUnified.player.camera.position.z);
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await page.waitForTimeout(800); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
  const z2 = await page.evaluate(() => window.sdpUnified.player.camera.position.z);
  expect(z1 - z2).toBeGreaterThan((z0 - z1) * 1.25);
  const server = await page.evaluate(() => { const s = window.sdpUnified.network.snapshot!; return s.players.find(p => p.playerId === s.localPlayerId)!.z; });
  expect(Math.abs(server - z2)).toBeLessThan(.5);
});
test('actual requests stay lazy; both scenes render; controls and repeated return work', async ({ page }, info) => {
  const requests: string[] = [], errors: string[] = [];
  page.on('request', request => requests.push(request.url())); page.on('pageerror', error => errors.push(error.message));
  await enterLimbo(page); await page.screenshot({ path: info.outputPath('limbo-desktop.png') });
  const baselineMemory = await page.evaluate(() => ({ ...window.sdpUnified.scene.renderer.info.memory }));
  expect(await visiblePixels(page)).toBeGreaterThan(300);
  expect(requests.filter(shooterRequest)).toEqual([]);
  await openProtocol(page); await page.waitForTimeout(1000);
  await page.screenshot({ path: info.outputPath('protocol-menu.png') });
  expect(requests.filter(shooterRequest)).toEqual([]);
  await enterShooter(page);
  expect(requests.some(url => url.includes('dust2plainmap.glb'))).toBe(true);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter?.player?.grounded)).toBe(true);
  expect(await visiblePixels(page)).toBeGreaterThan(10000);
  await page.screenshot({ path: info.outputPath('shooter-desktop.png') });
  const start = await page.evaluate(() => window.sdpUnified.modes.shooter!.player!.current.toArray());
  await page.keyboard.down('KeyW'); await page.waitForTimeout(700); await page.keyboard.up('KeyW');
  const moved = await page.evaluate(() => window.sdpUnified.modes.shooter!.player!.current.toArray());
  expect(Math.hypot(start[0] - moved[0], start[2] - moved[2])).toBeGreaterThan(.4);
  await page.keyboard.down('ControlLeft');
  await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter!.player!.height)).toBeLessThan(1.3);
  await page.keyboard.up('ControlLeft');
  await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter!.player!.height)).toBeGreaterThan(1.7);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter!.player!.grounded)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter!.player!.grounded)).toBe(true);
  await page.mouse.click(720, 500);
  await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter!.shooting!.shotsFired)).toBeGreaterThan(0);
  await expect(page.locator('.shooter-magazine')).toHaveText('29');
  await page.keyboard.press('KeyR'); await expect(page.locator('.shooter-action')).toHaveText('RELOADING');
  await expect(page.locator('.shooter-magazine')).toHaveText('30');
  await page.keyboard.press('Enter'); await page.getByRole('textbox', { name: 'Chat message' }).fill('Shooter room only'); await page.keyboard.press('Enter');
  await expect(page.locator('.chat-message')).toContainText('Shooter room only');
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'RESUME', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.sdpUnified.modes.value)).toBe('SHOOTER');
  await page.evaluate(() => window.retiredShooter = window.sdpUnified.modes.shooter);
  await page.getByRole('button', { name: 'RETURN TO LIMBO' }).click();
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'LIMBO');
  await expect(page.locator('.chat-message')).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(1);
  const steps = await page.evaluate(() => window.retiredShooter!.fixedSteps);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.retiredShooter!.fixedSteps)).toBe(steps);
  expect(await page.evaluate(() => window.retiredShooter!.scene.children.length)).toBe(0);
  const firstReturnMemory = await page.evaluate(() => ({ ...window.sdpUnified.scene.renderer.info.memory }));
  expect(firstReturnMemory.geometries).toBeLessThanOrEqual(baselineMemory.geometries + 4);
  expect(firstReturnMemory.textures).toBeLessThanOrEqual(baselineMemory.textures + 4);
  await page.getByRole('button', { name: 'CLICK TO RESUME' }).click();
  await openProtocol(page); await enterShooter(page);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'RETURN TO LIMBO' }).click();
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'LIMBO');
  await page.waitForTimeout(300);
  const secondReturnMemory = await page.evaluate(() => ({ ...window.sdpUnified.scene.renderer.info.memory }));
  expect(secondReturnMemory.geometries).toBeLessThanOrEqual(firstReturnMemory.geometries + 1);
  expect(secondReturnMemory.textures).toBeLessThanOrEqual(firstReturnMemory.textures + 1);
  expect(requests.filter(url => url.includes('dust2plainmap.glb'))).toHaveLength(1);
  await page.screenshot({ path: info.outputPath('returned-limbo.png') });
  expect(errors).toEqual([]);
});
test('two browsers synchronize in Shooter and stay isolated from Limbo voice and chat', async ({ browser }, info) => {
  const a = await browser.newContext(), b = await browser.newContext(), c = await browser.newContext();
  const first = await a.newPage(), second = await b.newPage(), limbo = await c.newPage();
  const errors: string[] = []; for (const page of [first, second, limbo]) page.on('pageerror', error => errors.push(error.message));
  try {
    await enterLimbo(first); await enterLimbo(second); await enterLimbo(limbo);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.network.status.online)).toBe(3);
    await first.bringToFront(); if (await first.locator('.resume-button').isVisible()) await first.locator('.resume-button').click();
    await openProtocol(first); await enterShooter(first);
    expect(await first.evaluate(() => window.sdpUnified.voiceTransport.state)).toBe('disconnected');
    await second.bringToFront(); if (await second.locator('.resume-button').isVisible()) await second.locator('.resume-button').click();
    await openProtocol(second); await enterShooter(second);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.network.status.online)).toBe(2);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.modes.shooter!.remotes.count)).toBe(1);
    for (const page of [first, second]) {
      expect(await page.evaluate(() => {
        const app = window.sdpUnified, state = app.network.snapshot!;
        const local = state.players.find(player => player.playerId === state.localPlayerId)!;
        const spawn = app.modes.shooter!.player!.spawn;
        return Math.hypot(spawn.x - local.spawnX!, spawn.y - local.spawnY!, spawn.z - local.spawnZ!);
      })).toBeLessThan(.01);
    }
    await expect.poll(() => limbo.evaluate(() => window.sdpUnified.network.status.online)).toBe(1);
    const rooms = await Promise.all([first.evaluate(() => window.sdpUnified.network.status.roomId), second.evaluate(() => window.sdpUnified.network.status.roomId), limbo.evaluate(() => window.sdpUnified.network.status.roomId)]);
    expect(rooms[0]).toBe(rooms[1]); expect(rooms[0]).not.toBe(rooms[2]);
    await first.bringToFront(); if (await first.getByRole('button', { name: 'RESUME', exact: true }).isVisible()) await first.getByRole('button', { name: 'RESUME', exact: true }).click();
    const position = await second.evaluate(() => window.sdpUnified.modes.shooter!.remotes.group.children[0].position.toArray());
    await first.keyboard.down('KeyA'); await first.waitForTimeout(1000); await first.keyboard.up('KeyA');
    await expect.poll(() => second.evaluate(before => { const p = window.sdpUnified.modes.shooter!.remotes.group.children[0].position; return Math.hypot(p.x - before[0], p.z - before[2]); }, position)).toBeGreaterThan(.5);
    await first.mouse.click(720, 500); await expect.poll(() => second.evaluate(() => window.sdpUnified.network.snapshot!.players.some(p => p.playerId !== window.sdpUnified.network.snapshot!.localPlayerId && p.ammo === 29))).toBe(true);
    await first.keyboard.press('Enter'); await first.getByRole('textbox', { name: 'Chat message' }).fill('Only combat room'); await first.keyboard.press('Enter');
    await expect(second.locator('.chat-message')).toContainText('Only combat room'); await expect(limbo.locator('.chat-message')).toHaveCount(0);
    await second.evaluate(() => {
      const game = window.sdpUnified.modes.shooter!, remote = game.remotes.group.children[0].position, own = game.player!.current;
      game.input.yaw = Math.atan2(-(remote.x - own.x), -(remote.z - own.z));
      game.input.pitch = Math.atan2(remote.y + 1.2 - (own.y - game.player!.height / 2 + 1.7), Math.hypot(remote.x - own.x, remote.z - own.z));
      window.sdpUnified.modes.ui.hide(); game.remotes.group.children[0].visible = false;
    });
    await second.waitForTimeout(300);
    const withoutAvatar = await sharp(await second.locator('canvas').screenshot()).removeAlpha().raw().toBuffer();
    await second.evaluate(() => window.sdpUnified.modes.shooter!.remotes.group.children[0].visible = true);
    const withAvatar = await sharp(await second.locator('canvas').screenshot()).removeAlpha().raw().toBuffer();
    let avatarPixels = 0;
    for (let i = 0; i < withoutAvatar.length; i += 3) if (Math.abs(withoutAvatar[i] - withAvatar[i]) + Math.abs(withoutAvatar[i + 1] - withAvatar[i + 1]) + Math.abs(withoutAvatar[i + 2] - withAvatar[i + 2]) > 12) avatarPixels++;
    expect(avatarPixels).toBeGreaterThan(250);
    await second.screenshot({ path: info.outputPath('two-shooter-players.png') });
    await first.close(); await expect.poll(() => second.evaluate(() => window.sdpUnified.modes.shooter!.remotes.count)).toBe(0);
    expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); await c.close(); }
});
test('failed assets allow retry and returning; mobile Limbo remains framed', async ({ page, browser }, info) => {
  await page.route('**/shooter/MAP/dust2plainmap.glb', route => route.abort());
  await enterLimbo(page); await openProtocol(page); await page.getByRole('button', { name: 'JOIN SHOOTER TEST', exact: true }).click();
  await expect(page.getByRole('button', { name: 'RETRY', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'RETURN TO LIMBO' }).click(); await expect(page.locator('#app')).toHaveAttribute('data-mode', 'LIMBO');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const mobile = await context.newPage(); await mobile.goto('/'); await mobile.getByRole('button', { name: 'VIEW EXHIBITION' }).click();
    await expect(mobile.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
    await mobile.getByRole('button', { name: 'Inspect sculpture', exact: true }).click();
    await expect(mobile.locator('.ui')).toHaveAttribute('data-state', 'INSPECTING'); expect(await visiblePixels(mobile)).toBeGreaterThan(1000);
    const button = await mobile.getByRole('button', { name: 'JOIN SHOOTER TEST', exact: true }).boundingBox();
    const controls = await mobile.locator('.controls-overlay').boundingBox();
    expect(button!.y + button!.height).toBeLessThan(controls!.y);
    await mobile.screenshot({ path: info.outputPath('limbo-mobile-inspection.png') });
    await mobile.getByRole('button', { name: 'Close inspection' }).click(); await expect(mobile.locator('canvas')).toHaveCount(1);
  } finally { await context.close(); }
});
test('Limbo text and real WebRTC media work; voice disconnects in Shooter and returns using one audio context', async ({ browser, request }) => {
  const health = await (await request.get('/multiplayer/health')).json() as { voice: string };
  test.skip(health.voice !== 'configured', 'Requires a real local or configured LiveKit service.');
  const a = await browser.newContext(), b = await browser.newContext();
  try {
    const first = await a.newPage(), second = await b.newPage();
    await first.addInitScript(() => {
      window.audioContexts = 0;
      window.createdAudioContexts = [];
      const original = window.AudioContext;
      window.AudioContext = new Proxy(original, { construct(target, args) {
        window.audioContexts++; const context = Reflect.construct(target, args) as AudioContext;
        window.createdAudioContexts.push(context); return context;
      } });
    });
    await enterLimbo(first); await enterLimbo(second);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.voiceTransport.state)).toBe('connected');
    await expect.poll(() => second.evaluate(() => window.sdpUnified.voiceTransport.state)).toBe('connected');
    await first.bringToFront(); if (await first.locator('.resume-button').isVisible()) await first.locator('.resume-button').click();
    await first.keyboard.press('Enter'); await first.getByRole('textbox', { name: 'Chat message' }).fill('Shared Limbo'); await first.keyboard.press('Enter');
    await expect(second.locator('.chat-message')).toContainText('Shared Limbo');
    await expect(first.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
    await first.waitForFunction(() => !!document.pointerLockElement && document.hasFocus());
    await first.keyboard.down('KeyV');
    await expect.poll(() => first.evaluate(() => window.sdpUnified.voiceTransport.transmitting)).toBe(true);
    await expect.poll(() => second.evaluate(async () => {
      const data = await window.sdpUnified.voiceTransport.diagnostics();
      return data.remote.reduce((total, remote) => total + (remote.stats?.bytesReceived || 0), 0);
    })).toBeGreaterThan(100);
    await first.keyboard.up('KeyV'); await expect.poll(() => first.evaluate(() => window.sdpUnified.voiceTransport.transmitting)).toBe(false);
    await openProtocol(first); await enterShooter(first);
    expect(await first.evaluate(() => window.sdpUnified.voiceTransport.state)).toBe('disconnected');
    await expect.poll(() => first.evaluate(() => window.createdAudioContexts.filter(context => context.state !== 'closed').length)).toBe(1);
    await first.keyboard.press('Escape'); await first.getByRole('button', { name: 'RETURN TO LIMBO' }).click();
    await expect.poll(() => first.evaluate(() => window.sdpUnified.voiceTransport.state)).toBe('connected');
    await expect.poll(() => first.evaluate(() => window.createdAudioContexts.filter(context => context.state !== 'closed').length)).toBe(1);
  } finally { await a.close(); await b.close(); }
});

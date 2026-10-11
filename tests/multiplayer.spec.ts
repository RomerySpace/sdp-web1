import { expect, test, type Page } from '@playwright/test';
import { Client, type Room } from '@colyseus/sdk';
import sharp from 'sharp';
import { LOBBY_NAME } from '../shared/MultiplayerProtocol';
import type { LobbyState } from '../server/src/state/LobbyState';
import type { ColyseusNetworkAdapter } from '../src/network/ColyseusNetworkAdapter';
import type { FirstPersonController } from '../src/player/FirstPersonController';
import type { RemotePlayerManager } from '../src/scene/RemotePlayerManager';
import type { LiveKitVoiceTransport } from '../src/audio/LiveKitVoiceTransport';
import type { VoiceChatManager } from '../src/audio/VoiceChatManager';
import type { ChatManager } from '../src/chat/ChatManager';

declare global {
  interface Window {
    sdpMultiplayer: {
      connection: ColyseusNetworkAdapter;
      remotes: RemotePlayerManager;
      player: FirstPersonController;
      voice: VoiceChatManager;
      voiceTransport: LiveKitVoiceTransport;
      chat: ChatManager;
    };
  }
}

async function enter(page: Page): Promise<void> {
  await page.goto('/?multiplayerDebug=1');
  await expect(page.locator('.connection-indicator')).toHaveAttribute('data-connection', 'connected');
  await page.getByRole('button', { name: 'CLICK TO ENTER' }).click();
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
}

test('two actual browsers see movement, rotation and departure with live population', async ({ browser }, testInfo) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  const errors: string[] = [];
  first.on('pageerror', (error) => errors.push(error.message));
  second.on('pageerror', (error) => errors.push(error.message));
  try {
    await enter(first);
    await enter(second);
    await expect(first.locator('.connection-indicator')).toContainText('ONLINE: 2 / 25');
    await expect(second.locator('.connection-indicator')).toContainText('ONLINE: 2 / 25');
    const firstSession = await first.evaluate(() => window.sdpMultiplayer.connection.snapshot!);
    const secondSession = await second.evaluate(() => window.sdpMultiplayer.connection.snapshot!);
    expect(firstSession.roomId).toBe(secondSession.roomId);
    expect(firstSession.localPlayerId).not.toBe(secondSession.localPlayerId);
    const firstPlayer = firstSession.players.find((player) => player.playerId === firstSession.localPlayerId)!;
    const secondPlayer = secondSession.players.find((player) => player.playerId === secondSession.localPlayerId)!;
    expect(Math.hypot(firstPlayer.x - secondPlayer.x, firstPlayer.z - secondPlayer.z)).toBeGreaterThan(1);
    await expect.poll(() => second.evaluate(() => window.sdpMultiplayer.remotes.count)).toBe(1);
    const initial = await second.evaluate(() => {
      const group = window.sdpMultiplayer.remotes.group.children[0];
      return { x: group.position.x, z: group.position.z, uuid: group.uuid };
    });
    await first.bringToFront();
    if (await first.locator('.resume-button').isVisible()) await first.locator('.resume-button').click();
    await expect(first.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
    await first.keyboard.down('KeyA');
    await first.waitForTimeout(1200);
    await first.keyboard.up('KeyA');
    await expect.poll(() => second.evaluate(() => window.sdpMultiplayer.remotes.group.children[0].position.x)).toBeLessThan(initial.x - 2);
    expect(await second.evaluate(() => window.sdpMultiplayer.remotes.group.children[0].uuid)).toBe(initial.uuid);
    await first.evaluate(() => window.dispatchEvent(new MouseEvent('mousemove', { movementX: 160, movementY: 0 })));
    await expect.poll(() => second.evaluate(() => Math.abs(window.sdpMultiplayer.remotes.group.children[0].rotation.y))).toBeGreaterThan(0.15);
    await second.evaluate(() => {
      const app = window.sdpMultiplayer;
      const remote = app.remotes.group.children[0];
      app.player.camera.lookAt(remote.position.x, 0.8, remote.position.z);
      remote.visible = false;
    });
    const baseline = await second.screenshot();
    await second.evaluate(() => { window.sdpMultiplayer.remotes.group.children[0].visible = true; });
    const visible = await second.screenshot({ path: testInfo.outputPath('two-visitors.png') });
    const a = await sharp(baseline).removeAlpha().raw().toBuffer();
    const b = await sharp(visible).removeAlpha().raw().toBuffer();
    let changed = 0;
    for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) changed++;
    expect(changed).toBeGreaterThan(250);
    await second.setViewportSize({ width: 390, height: 844 });
    await second.screenshot({ path: testInfo.outputPath('mobile-connection.png') });
    const indicator = await second.locator('.connection-indicator').boundingBox();
    expect(indicator!.x).toBeGreaterThan(80);
    expect(indicator!.x + indicator!.width).toBeLessThan(390);
    await first.close();
    await expect(second.locator('.connection-indicator')).toContainText('ONLINE: 1 / 25');
    await expect.poll(() => second.evaluate(() => window.sdpMultiplayer.remotes.count)).toBe(0);
    expect(errors).toEqual([]);
  } finally { await firstContext.close(); await secondContext.close(); }
});

test('temporary WebSocket drop reconnects the same session', async ({ page }) => {
  await enter(page);
  const before = await page.evaluate(() => window.sdpMultiplayer.connection.snapshot!);
  await page.evaluate(() => {
    const network = window.sdpMultiplayer.connection;
    const changes: string[] = [];
    Object.assign(window, { testConnectionChanges: changes });
    network.subscribeToStatus((status) => changes.push(status.state));
    const room = (network as unknown as { room: { connection: { close(code: number): void } } }).room;
    room.connection.close(4010);
  });
  await expect.poll(() => page.evaluate(() => {
    const changes = (window as unknown as { testConnectionChanges: string[] }).testConnectionChanges;
    return changes.includes('connecting') && changes[changes.length - 1] === 'connected';
  })).toBe(true);
  const after = await page.evaluate(() => window.sdpMultiplayer.connection.snapshot!);
  expect(after.localPlayerId).toBe(before.localPlayerId);
  expect(after.roomId).toBe(before.roomId);
  await expect(page.locator('.connection-indicator')).toContainText('ONLINE: 1 / 25');
  if (process.env.SDP_TEST_LAN === '1') await expect(page.locator('.controls-overlay')).toHaveAttribute('data-voice-connection', 'connected', { timeout: 20000 });
});

test('unavailable backend leaves the exhibition and local controls usable', async ({ page }) => {
  await page.route('**/matchmake/**', (route) => route.abort());
  await page.goto('/?multiplayerDebug=1');
  await expect(page.locator('.connection-indicator')).toHaveAttribute('data-connection', 'disconnected');
  await page.getByRole('button', { name: 'CLICK TO ENTER' }).click();
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyD');
  expect(await page.evaluate(() => window.sdpMultiplayer.player.camera.position.x)).toBeGreaterThan(1.5);
  await expect(page.locator('.connection-indicator')).toContainText('ONLINE: 0 / 25');
});

test('server rejects teleport input, stale sequences and packet-driven speed boosts', async () => {
  const client = new Client(`http://127.0.0.1:${process.env.SDP_TEST_SERVER_PORT || 2567}`);
  const room = await client.create<LobbyState>(LOBBY_NAME, { x: 10000, z: 10000 });
  try {
    await expect.poll(() => room.state?.players?.size).toBe(1);
    const player = room.state.players.get(room.sessionId)!;
    expect(player.x).toBe(0);
    expect(player.z).toBe(9);
    room.send('input', { seq: 1, f: 1, r: 0, y: 0, p: 0, active: true, x: 9999 });
    room.send('input', { seq: 2, f: 900, r: 0, y: 0, p: 0, active: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(player.z).toBe(9);
    for (let i = 3; i < 33; i++) room.send('input', { seq: i, f: 1, r: 0, y: 0, p: 0, active: true });
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(player.z).toBeGreaterThan(8);
    expect(player.z).toBeLessThan(9);
    room.send('input', { seq: 33, f: 0, r: 0, y: 0, p: 0, active: false });
    await expect.poll(() => player.lastProcessedInput).toBe(33);
    const stopped = player.z;
    room.send('input', { seq: 32, f: 1, r: 0, y: 0, p: 0, active: true });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(player.z).toBe(stopped);
  } finally { await room.leave(); }
});

test('lobby capacity is 25 and overflow joins another available room', async () => {
  const client = new Client(`http://127.0.0.1:${process.env.SDP_TEST_SERVER_PORT || 2567}`);
  const rooms: Room[] = [];
  try {
    const first = await client.create<LobbyState>(LOBBY_NAME);
    rooms.push(first);
    for (let i = 1; i < 25; i++) rooms.push(await client.joinById(first.roomId));
    await expect.poll(() => first.state?.online).toBe(25);
    await expect(client.joinById(first.roomId)).rejects.toThrow();
    const overflow = await client.joinOrCreate<LobbyState>(LOBBY_NAME);
    rooms.push(overflow);
    expect(overflow.roomId).not.toBe(first.roomId);
    await expect.poll(() => overflow.state?.online).toBe(1);
  } finally { await Promise.all(rooms.map((room) => room.leave())); }
});

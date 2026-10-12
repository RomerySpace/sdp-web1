import { expect, test, type Page } from '@playwright/test';
import { CollisionManager } from '../src/player/CollisionManager';
import { ExperienceStateMachine } from '../src/core/ExperienceState';
import { ChatManager } from '../src/chat/ChatManager';
import type { MultiplayerConnection } from '../src/network/MultiplayerConnection';
import type { RoomChatMessage } from '../shared/CommunicationProtocol';
import { validateChatText } from '../shared/CommunicationProtocol';
import { enterExhibition, submitName } from './entry';

async function load(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.ui')).toHaveAttribute('data-hdr', 'loaded');
  await expect(page.getByRole('button', { name: 'CLICK TO ENTER' })).toBeEnabled();
}

async function enter(page: Page): Promise<void> {
  await load(page);
  await enterExhibition(page);
  await expect.poll(() => page.evaluate(() => Boolean(document.pointerLockElement))).toBe(true);
}

test('HDR, reveal, navigation, chat, pause, audio preference and fullscreen', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await load(page);
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'INTRO');
  await page.screenshot({ path: testInfo.outputPath('01-intro.png') });
  await submitName(page);
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'ENTERING');
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  await page.waitForTimeout(1800); // Allow the restrained HUD fade to settle in the visual capture.
  await page.screenshot({ path: testInfo.outputPath('02-exploring.png') });
  const crosshair = await page.locator('.crosshair').boundingBox();
  expect(crosshair!.x + crosshair!.width / 2).toBe(720);
  expect(crosshair!.y + crosshair!.height / 2).toBe(500);

  await page.keyboard.down('KeyW');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'CHATTING');
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  await page.getByRole('textbox', { name: 'Chat message' }).fill('   ');
  await page.keyboard.press('Enter');
  await expect(page.locator('.chat-message')).toHaveCount(0);
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'CHATTING');
  await page.getByRole('textbox', { name: 'Chat message' }).fill('WASD and V stay in this message <script>');
  await page.keyboard.press('Enter');
  await expect(page.locator('.chat-message')).toHaveText('YOU: WASD and V stay in this message <script>');
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Chat message' })).toBeHidden();
  await page.evaluate(() => document.exitPointerLock());
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'PAUSED');
  await page.getByRole('button', { name: 'Mute ambient sound' }).click();
  await expect(page.getByRole('button', { name: 'Unmute ambient sound' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('sdp:muted'))).toBe('true');
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Exit fullscreen' }).click();
  await page.getByRole('button', { name: 'CLICK TO RESUME' }).click();
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Unmute ambient sound' })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('push-to-talk stops on release and cannot activate while typing', async ({ page }) => {
  test.skip(process.env.SDP_TEST_LAN !== '1', 'Real voice is tested with the local LiveKit LAN services.');
  await enter(page);
  await page.keyboard.down('Shift');
  await page.keyboard.down('KeyV');
  await expect(page.locator('.controls-overlay')).toHaveAttribute('data-voice', 'speaking');
  await page.keyboard.up('KeyV');
  await page.keyboard.up('Shift');
  await expect(page.locator('.controls-overlay')).toHaveAttribute('data-voice', 'ready');
  await page.keyboard.press('Enter');
  await page.keyboard.type('wasd V');
  await expect(page.getByRole('textbox', { name: 'Chat message' })).toHaveValue('wasd V');
  await expect(page.locator('.controls-overlay')).toHaveAttribute('data-voice', 'ready');
});

test('microphone permission completing after release never leaves live tracks', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      Object.assign(window, { testMicStream: stream });
      await new Promise((resolve) => setTimeout(resolve, 750));
      return stream;
    };
  });
  await enter(page);
  await page.keyboard.down('KeyV');
  await expect(page.locator('.controls-overlay')).toHaveAttribute('data-voice', 'requesting');
  await page.keyboard.up('KeyV');
  await expect(page.locator('.controls-overlay')).toHaveAttribute('data-voice', 'ready');
  expect(await page.evaluate(() => (window as unknown as { testMicStream: MediaStream }).testMicStream.getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
});

test('denied microphone and denied pointer lock remain recoverable', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await enter(page);
  await page.keyboard.down('KeyV');
  await expect(page.locator('.controls-overlay')).toHaveAttribute('data-voice', 'denied');
  await page.keyboard.up('KeyV');
  await page.evaluate(() => document.exitPointerLock());
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'PAUSED');
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.requestPointerLock = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
  });
  await page.getByRole('button', { name: 'CLICK TO RESUME' }).click();
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'PAUSED');
  await expect(page.locator('.ui-notice')).toContainText('Mouse control was not granted');
});

test('touch device has a working viewing mode', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('/');
  await enterExhibition(page);
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  await expect(page.locator('.viewing-note')).toContainText('DESKTOP REQUIRED');
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  await context.close();
});

test('movement is time-based, collides, slides, and pauses without drifting', async ({ page }) => {
  await load(page);
  const positions = await page.evaluate(async () => {
    const controllerPath = '/src/player/FirstPersonController.ts';
    const threePath = '/node_modules/.vite/deps/three.js';
    const { FirstPersonController } = await import(controllerPath);
    const { PerspectiveCamera } = await import(threePath);
    const positions: number[] = [];
    for (const fps of [30, 60, 144]) {
      const controller = new FirstPersonController(new PerspectiveCamera(), document.createElement('canvas'));
      Object.defineProperty(controller, 'locked', { get: () => true });
      controller.setEnabled(true);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      for (let i = 0; i < fps; i++) controller.update(1 / fps);
      positions.push(controller.camera.position.z);
      for (let i = 0; i < fps * 4; i++) controller.update(1 / fps);
      positions.push(controller.camera.position.z);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
      for (let i = 0; i < fps * 2; i++) controller.update(1 / fps);
      positions.push(controller.camera.position.x);
      controller.setEnabled(false);
      const before = controller.camera.position.clone();
      controller.update(1);
      positions.push(controller.camera.position.distanceTo(before));
      controller.dispose();
    }
    return positions;
  });
  for (let i = 0; i < positions.length; i += 4) {
    expect(positions[i]).toBeGreaterThan(6);
    expect(positions[i]).toBeLessThan(6.5);
    expect(positions[i + 1]).toBeGreaterThanOrEqual(1.48);
    expect(positions[i + 1]).toBeLessThan(1.6);
    expect(positions[i + 2]).toBeGreaterThan(3.5);
    expect(positions[i + 3]).toBe(0);
  }
  expect(Math.abs(positions[0] - positions[8])).toBeLessThan(0.05);
});

test('collision prevents tunnelling and room chat waits for a server echo', () => {
  const collision = new CollisionManager();
  const position = { x: 0, z: 9 };
  collision.move(position, 0, -100);
  expect(position.z).toBeGreaterThanOrEqual(1.48);
  let receive!: (message: RoomChatMessage) => void;
  const transport = {
    snapshot: { localPlayerId: 'visitor-one' },
    subscribeToChat: (callback: typeof receive) => { receive = callback; return () => {}; },
    sendChat: (text: string) => !!validateChatText(text),
  } as unknown as MultiplayerConnection;
  const chat = new ChatManager(transport);
  expect(chat.submit(' \n ')).toBe(false);
  expect(chat.submit(' A single visitor ')).toBe(true);
  expect(chat.history).toHaveLength(0);
  receive({ messageId: 'one', senderId: 'visitor-one', senderName: 'VISITOR 01', message: 'A single visitor',
    timestamp: Date.now(), roomId: 'lobby-one', position: { x: 0, y: 1.7, z: 9 } });
  expect(chat.history).toHaveLength(1);
  expect(chat.history[0].message).toBe('A single visitor');
  expect(chat.history[0].senderName).toBe('YOU');
  expect(chat.history[0].position).toEqual({ x: 0, y: 1.7, z: 9 });
  chat.dispose();
});

test('state transitions ignore conflicting repeated actions', () => {
  const state = new ExperienceStateMachine();
  state.set('EXPLORING');
  expect(state.value).toBe('INTRO');
  state.set('ENTERING');
  state.set('ENTERING');
  state.set('CHATTING');
  expect(state.value).toBe('ENTERING');
  state.set('EXPLORING');
  state.set('CHATTING');
  state.set('PAUSED');
  state.set('EXPLORING');
  expect(state.value).toBe('EXPLORING');
});

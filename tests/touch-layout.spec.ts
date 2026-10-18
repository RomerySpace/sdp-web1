import { expect, test, webkit, type Page } from '@playwright/test';
import { touchDriver } from './touch-driver';
import type { TouchControls } from '../src/ui/TouchControls';
import type { ShooterHUD } from '../src/modes/shooter/ui/ShooterHUD';
import type { LobbySnapshot } from '../shared/MultiplayerProtocol';

declare global { interface Window { mobileLayout: { controls: TouchControls; hud: ShooterHUD; snapshot: LobbySnapshot; moves: number[][]; activeAtDown: boolean[]; events: string[] } } }
async function fixture(page: Page): Promise<void> {
  await page.route('**/__touch-layout', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body { background: #46535e; }</style><div id="app" data-input="touch" data-mode="SHOOTER" data-lighting="night"><div class="ui" data-state="EXPLORING"><div class="top-controls"></div></div></div>' }));
  await page.goto('/__touch-layout');
  await page.evaluate(async () => {
    for (const file of ['/src/styles/main.css', '/src/styles/modes.css', '/src/modes/shooter/styles/shooter.css', '/src/modes/shooter/strikes/airstrike.css']) await import(/* @vite-ignore */ file);
    const { TouchControls } = await import(/* @vite-ignore */ '/src/ui/' + 'TouchControls.ts');
    const { ShooterHUD } = await import(/* @vite-ignore */ '/src/modes/shooter/ui/' + 'ShooterHUD.ts');
    const { ConnectionIndicator } = await import(/* @vite-ignore */ '/src/ui/' + 'ConnectionIndicator.ts');
    const { ChatInterface } = await import(/* @vite-ignore */ '/src/ui/' + 'ChatInterface.ts');
    const root = document.querySelector<HTMLElement>('#app')!, moves: number[][] = [];
    const controls: TouchControls = new TouchControls(root, { move: (f: number, r: number) => moves.push([f, r]), look: () => {}, action: () => {}, reset: () => moves.push([0, 0]) });
    controls.update('shooter', 'fixture');
    new ConnectionIndicator(document.querySelector('.top-controls')!).update({ state: 'connected', online: 25, capacity: 25, roomId: 'layout-only' });
    const hud: ShooterHUD = new ShooterHUD(root, () => {}); hud.element.hidden = false;
    const snapshot: LobbySnapshot = { roomId: 'layout-only', localPlayerId: 'local', tick: 0, receivedAt: 0, serverTime: 1000,
      match: { phase: 'playing', round: 1, endsAt: 421000, nextRoundAt: 0, results: [] },
      players: [{ playerId: 'local', displayName: 'MOBILE VISITOR', connected: true, x: 0, y: 1.7, z: 0, yaw: 0, pitch: 0, lastProcessedInput: 0, streak: 0, strikes: 0 }], killFeed: [] };
    hud.receive(snapshot);
    const chat = new ChatInterface(document.querySelector('.ui')!, () => {}, () => {});
    for (let i = 0; i < 3; i++) chat.add({ messageId: String(i), roomId: 'layout-only', senderId: 'peer', senderName: 'Visitor', message: 'A room message should never overlap the touch controls.', timestamp: 0, position: { x: 0, y: 0, z: 0 } });
    Object.assign(window, { mobileLayout: { controls, hud, snapshot, moves, activeAtDown: [], events: [] } });
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'resize', 'blur']) window.addEventListener(type, event => window.mobileLayout.events.push(`${type}:${(event as PointerEvent).pointerId ?? ''}`), { capture: true });
    document.querySelector('.touch-stick')!.addEventListener('pointerdown', () => window.mobileLayout.activeAtDown.push(document.querySelector('.touch-stick')!.classList.contains('is-active')));
  });
}
async function rewards(page: Page, ready: boolean): Promise<void> {
  await page.evaluate(ready => {
    const { hud, snapshot } = window.mobileLayout;
    const players = snapshot.players.map(p => ({ ...p, streak: ready ? 12 : 0, strikes: ready ? 7 : 0, kills: 12, deaths: 3 }));
    const killFeed = Array.from({ length: 6 }, (_, i) => ({ id: String(i), attackerId: 'local', victimId: `target${i}`, attackerName: 'LONG PLAYER NAME 001', victimName: 'LONG PLAYER NAME 002', region: 'torso' as const, timestamp: 1000 + i }));
    hud.receive({ ...snapshot, players, killFeed });
    // Expose announcement and ammunition layout without running a simulation.
    hud.element.querySelector<HTMLElement>('.kill-announcement')!.hidden = false;
    hud.element.querySelector('.shooter-health')!.textContent = '100 / HP';
    hud.element.querySelector('.shooter-action')!.textContent = 'RELOADING';
    hud.notice('AIRSTRIKE / TARGET CONFIRMED');
  }, ready);
}
async function noOverlap(page: Page): Promise<void> {
  const boxes = await page.locator('.touch-button, .touch-stick, .connection-indicator, .shooter-hud header, .shooter-round, .shooter-score, .shooter-kill-feed, .streak-meter, .shooter-health, .shooter-ammo, .strike-status, .chat:not(.is-open) .chat-history').evaluateAll(nodes => nodes.filter(node => {
    const style = getComputedStyle(node); return node.getClientRects().length > 0 && style.visibility !== 'hidden';
  }).map(node => { const r = node.getBoundingClientRect(); return { name: node.getAttribute('aria-label') || node.className || node.tagName, x: r.x, y: r.y, w: r.width, h: r.height }; }).filter(r => r.w > 0 && r.h > 0));
  const viewport = page.viewportSize()!;
  for (const box of boxes) {
    expect(box.x, box.name).toBeGreaterThanOrEqual(-.1); expect(box.y, box.name).toBeGreaterThanOrEqual(-.1);
    expect(box.x + box.w, box.name).toBeLessThanOrEqual(viewport.width + .1); expect(box.y + box.h, box.name).toBeLessThanOrEqual(viewport.height + .1);
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const area = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    expect(area, `${a.name} overlaps ${b.name}`).toBeLessThan(.5);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
}

test('mobile joystick appears only during native contact and clears on cancel, focus loss and resize', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), page = await context.newPage();
  try {
    await fixture(page);
    const stick = page.locator('.touch-stick'), driver = await touchDriver(page), box = (await stick.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await expect(stick).toHaveCSS('opacity', '0');
    await driver.down(1, x, y); await expect(stick).toHaveClass(/is-active/); await expect(stick).toHaveCSS('opacity', '1');
    await driver.move(1, x, y - box.width * .3);
    expect(await page.evaluate(() => window.mobileLayout.moves.at(-1)![0])).toBeGreaterThan(.8);
    await driver.down(2, 280, 300); await driver.up(2);
    expect(await stick.getAttribute('class'), JSON.stringify(await page.evaluate(() => window.mobileLayout.events))).toContain('is-active');
    await driver.up(1); await expect(stick).not.toHaveClass(/is-active/); await expect(stick).toHaveCSS('opacity', '0');
    expect(await page.evaluate(() => window.mobileLayout.moves.at(-1))).toEqual([0, 0]);
    for (const stop of ['cancel', 'blur', 'resize'] as const) {
      await driver.down(1, x, y); await driver.move(1, x, y - box.width * .3);
      if (stop === 'cancel') await driver.cancel(); else { await page.evaluate(event => window.dispatchEvent(new Event(event)), stop); await driver.cancel(); }
      await expect(stick).not.toHaveClass(/is-active/); expect(await page.evaluate(() => window.mobileLayout.moves.at(-1))).toEqual([0, 0]);
    }
    await page.touchscreen.tap(280, 300); await expect(stick).not.toHaveClass(/is-active/);
    expect(await page.evaluate(() => window.mobileLayout.activeAtDown.every(Boolean))).toBe(true);
  } finally { await context.close(); }
});

test('mobile HUD keeps available rewards and latest eliminations away from controls across viewports', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), page = await context.newPage();
  try {
    await fixture(page);
    for (const [width, height] of [[390, 844], [320, 568], [375, 667], [844, 390], [667, 375], [640, 320], [1024, 768]]) {
      await page.setViewportSize({ width, height }); await rewards(page, false);
      await expect(page.locator('.streak-meter')).toBeHidden(); await expect(page.locator('.kill-announcement')).toBeHidden(); await noOverlap(page);
      await rewards(page, true); await expect(page.getByRole('button', { name: 'Deploy airstrike 1' })).toBeVisible(); await noOverlap(page);
      expect(await page.locator('.streak-meter button:visible').count()).toBe(3);
      if (height > 500) {
        expect(await page.locator('.shooter-kill-feed li:visible').count()).toBe(2);
        await expect(page.locator('.shooter-kill-feed li:visible').first()).toHaveAttribute('data-kill-id', '4');
      }
      await page.screenshot({ path: `/private/tmp/sdp-mobile-hud-${width}x${height}.png` });
    }
  } finally { await context.close(); }
});

test('WebKit mobile joystick responds to real taps and its HUD fits portrait and landscape', async () => {
  const browser = await webkit.launch({ headless: true, channel: undefined, args: [] });
  const context = await browser.newContext({ baseURL: process.env.SDP_UNIFIED_TEST_URL || 'http://localhost:5383', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), page = await context.newPage();
  try {
    await fixture(page);
    const stick = page.locator('.touch-stick'), box = (await stick.boundingBox())!;
    await expect(stick).toHaveCSS('opacity', '0'); await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    expect(await page.evaluate(() => window.mobileLayout.activeAtDown)).toEqual([true]);
    await expect(stick).not.toHaveClass(/is-active/); await expect(stick).toHaveCSS('opacity', '0');
    for (const [width, height] of [[390, 844], [320, 568], [844, 390], [667, 375]]) {
      await page.setViewportSize({ width, height }); await rewards(page, true); await noOverlap(page);
      await page.screenshot({ path: `/private/tmp/sdp-webkit-hud-${width}x${height}.png` });
    }
  } finally { await context.close(); await browser.close(); }
});

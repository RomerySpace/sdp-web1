import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createVite, type ViteDevServer } from 'vite';
import { Client as SDK, type Room } from '@colyseus/sdk';
import { serverSessionKeys } from '../src/network/ServerRegions';

const children: ChildProcess[] = [];
let vite: ViteDevServer, url: string, eu: string, us: string;
const savedEnv = new Map<string, string | undefined>();
async function freePort(): Promise<number> {
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
async function backend(region: 'eu' | 'us'): Promise<string> {
  const port = await freePort(), address = `http://127.0.0.1:${port}`;
  const env = { ...process.env, SDP_REGION: region, NODE_ENV: 'test', ALLOWED_ORIGINS: '', ENABLE_SHOOTER_TEST: 'true', SDP_VISITOR_CAPACITY: '25', HOST: '127.0.0.1', PORT: String(port) };
  for (const key of Object.keys(env)) if (key.startsWith('LIVEKIT_')) delete env[key as keyof typeof env];
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd: `${process.cwd()}/server`, env, stdio: 'ignore' }); children.push(child);
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Local ${region} backend exited.`);
    try { if ((await fetch(`${address}/health`, { signal: AbortSignal.timeout(300) })).ok) return address; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Local ${region} backend did not start.`);
}
test.beforeAll(async () => {
  eu = await backend('eu'); us = await backend('us');
  const port = await freePort();
  const env = { VITE_SDP_EU_SERVER_URL: eu, VITE_SDP_US_SERVER_URL: us, VITE_SDP_US_ENABLED: 'true', SDP_WEB_PORT: String(port) };
  for (const [key, value] of Object.entries(env)) { savedEnv.set(key, process.env[key]); process.env[key] = value; }
  vite = await createVite({ root: process.cwd(), mode: 'unified', server: { host: '127.0.0.1', port, strictPort: true } });
  await vite.listen(); url = `http://127.0.0.1:${port}`;
});
test.afterAll(async () => {
  await vite?.close();
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const done = new Promise<void>(resolve => child.once('exit', () => resolve()));
    child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await done; clearTimeout(timer);
  }
  for (const [key, value] of savedEnv) if (value === undefined) delete process.env[key]; else process.env[key] = value;
});

test('default regional selector keeps USA disabled and fits desktop and mobile without loading Shooter', async ({ browser }) => {
  const context = await browser.newContext(), page = await context.newPage();
  const requests: string[] = []; page.on('request', request => { if (/\/shooter\/|ShooterMode|rapier/.test(request.url())) requests.push(request.url()); });
  try {
    await page.route('**/region-selector-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main id="app"></main>' }));
    await page.goto(`${url}/region-selector-fixture`);
    await page.evaluate(async () => {
      await import(/* @vite-ignore */ '/src/styles/' + 'main.css');
      const { IntroScreen } = await import(/* @vite-ignore */ '/src/ui/' + 'IntroScreen.ts');
      const { createServerRegions } = await import(/* @vite-ignore */ '/src/network/' + 'ServerRegions.ts');
      const screen = new IntroScreen(document.querySelector('#app')!, () => {}, false, 'Visitor');
      const regions = createServerRegions({}, location.origin);
      screen.configureRegions(regions, 'eu', (id: string) => { if (!regions.find((r: { id: string; available: boolean }) => r.id === id)?.available) throw new Error('This server is not available yet.'); });
      screen.ready(false); screen.chooseName();
    });
    const region = page.getByRole('combobox', { name: 'Server region' });
    await expect(region).toHaveValue('eu'); await expect(region.locator('option[value="us"]')).toBeDisabled();
    for (const [width, height] of [[1200, 850], [390, 844], [320, 568], [844, 390]]) {
      await page.setViewportSize({ width, height });
      const box = (await page.locator('.intro-name-form').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.y + box.height).toBeLessThanOrEqual(height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await page.screenshot({ path: `/private/tmp/sdp-region-entry-${width}.png` });
    }
    await region.evaluate(select => { const input = select as HTMLSelectElement; input.querySelector<HTMLOptionElement>('[value="us"]')!.disabled = false; input.value = 'us'; input.dispatchEvent(new Event('change')); });
    await expect(region).toHaveValue('eu'); await expect(page.locator('#intro-name-message')).toContainText('not available');
    expect(requests).toEqual([]);
  } finally { await context.close(); }
});

test('two real regional backends isolate names and invites, retain USA on reload/cuts and keep cross-mode transfers regional', async ({ browser }) => {
  const contexts = [await browser.newContext(), await browser.newContext()];
  const pages = [await contexts[0].newPage(), await contexts[1].newPage()];
  const errors: string[] = [], requests: string[][] = [[], []]; let peer: Room | undefined;
  try {
    for (const [i, page] of pages.entries()) {
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => requests[i].push(request.url()));
      await page.goto(`${url}/?debugMode=limbo`);
      await page.getByRole('button', { name: 'CLICK TO ENTER', exact: true }).click();
      await page.getByRole('combobox', { name: 'Server region' }).selectOption(i ? 'us' : 'eu');
      if (i) await page.evaluate(keys => {
        sessionStorage.setItem(keys.admission, 'eu-ticket-must-not-be-sent');
        sessionStorage.setItem(keys.reconnect, JSON.stringify({ token: 'eu-room:eu-secret', type: 'SDPLimboRoom', expires: Date.now() + 120000 }));
      }, serverSessionKeys(eu));
      await page.getByRole('textbox', { name: 'USERNAME', exact: true }).fill('Regional Visitor');
      if (i) {
        await page.route(`${us}/health`, route => route.fulfill({ json: { status: 'ok', region: 'eu' }, headers: { 'Access-Control-Allow-Origin': url } }));
        await page.getByRole('button', { name: 'ENTER', exact: true }).click();
        await expect(page.locator('#intro-name-message')).toContainText('does not match');
        await expect(page.getByRole('combobox', { name: 'Server region' })).toBeEnabled();
        expect(requests[i].some(address => /\/matchmake\//.test(address))).toBe(false);
        await page.unroute(`${us}/health`);
      }
      await page.getByRole('button', { name: 'ENTER', exact: true }).click();
      await expect(page.locator('.connection-indicator')).toHaveAttribute('data-connection', 'connected');
      await expect(page.locator('.connection-indicator')).toContainText(i ? 'US' : 'EU');
    }
    const [europe, america] = pages;
    const initial = await america.evaluate(() => ({ room: window.sdpUnified.network.snapshot!.roomId, id: window.sdpUnified.network.snapshot!.localPlayerId }));
    await america.reload();
    await america.getByRole('button', { name: 'CLICK TO ENTER', exact: true }).click();
    await expect(america.getByRole('combobox', { name: 'Server region' })).toHaveValue('us');
    await america.getByRole('button', { name: 'ENTER', exact: true }).click();
    await expect(america.locator('.connection-indicator')).toHaveAttribute('data-connection', 'connected');
    await expect.poll(() => america.evaluate(() => window.sdpUnified.network.snapshot!.localPlayerId)).toBe(initial.id);
    expect(await america.evaluate(() => window.sdpUnified.network.snapshot!.roomId)).toBe(initial.room);
    console.info('Regions: matching names accepted independently; USA reload kept its reservation.');
    const sdk = new SDK(us);
    await expect(sdk.joinOrCreate('SDPAdmission', { displayName: 'regional visitor' })).rejects.toThrow(/already in use/);
    const queue = await sdk.joinOrCreate('SDPAdmission', { displayName: 'USA Friend' });
    const token = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Admission timed out.')), 10000);
      queue.onMessage('queue:status', update => { if (update.ready) { clearTimeout(timeout); resolve(update.token); } });
    });
    queue.send('queue:sync'); const admissionToken = await token; await queue.leave();
    peer = await sdk.create('SDPShooterRoom', { displayName: 'USA Friend', admissionToken });
    peer.onMessage('*', () => {}); peer.onMessage('combat:ping', nonce => peer?.send('combat:pong', nonce));
    await europe.bringToFront();
    if (await europe.locator('.resume-button').isVisible()) await europe.locator('.resume-button').click();
    await expect(europe.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
    await europe.keyboard.press('Enter'); await europe.getByRole('textbox', { name: 'Chat message' }).fill('/invite USA Friend'); await europe.keyboard.press('Enter');
    await expect(europe.locator('.ui-notice')).toContainText('not connected to this server');
    expect(requests[0].some(address => address.startsWith(us))).toBe(false);
    peer.send('chat:send', '/invite Regional Visitor');
    await expect(america.getByRole('region', { name: 'Room invitations' })).toBeVisible();
    await expect(europe.getByRole('region', { name: 'Room invitations' })).toBeHidden();
    console.info('Regions: invitation stayed inside USA.');
    expect(requests[1].some(address => /\/shooter\/|ShooterMode/.test(address))).toBe(false);
    await america.bringToFront(); if (await america.locator('.resume-button').isVisible()) await america.locator('.resume-button').click();
    await expect(america.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
    await america.keyboard.press('Enter');
    await expect(america.getByRole('textbox', { name: 'Chat message' })).toBeVisible();
    await america.getByRole('button', { name: 'ACCEPT', exact: true }).click();
    await expect(america.locator('#app')).toHaveAttribute('data-mode', 'SHOOTER', { timeout: 90000 });
    await expect.poll(() => america.evaluate(() => window.sdpUnified.network.snapshot!.roomId)).toBe(peer.roomId);
    await america.getByRole('button', { name: 'ENTER SIMULATION', exact: true }).click();
    const shooterId = await america.evaluate(() => window.sdpUnified.network.snapshot!.localPlayerId);
    try {
      await contexts[1].setOffline(true); await expect(america.getByRole('alertdialog', { name: 'CONNECTION INTERRUPTED' })).toBeVisible();
    } finally { await contexts[1].setOffline(false); }
    await expect(america.locator('.connection-indicator')).toHaveAttribute('data-connection', 'connected');
    await expect.poll(() => america.evaluate(() => window.sdpUnified.network.snapshot!.localPlayerId)).toBe(shooterId);
    await expect(america.locator('.connection-indicator')).toContainText('US');
    await america.getByRole('button', { name: 'RETURN TO LIMBO', exact: true }).click();
    await expect(america.locator('#app')).toHaveAttribute('data-mode', 'LIMBO');
    await expect(america.locator('.connection-indicator')).toContainText('US');
    expect(requests[1].some(address => address.startsWith(eu))).toBe(false);
    expect(await america.evaluate(keys => sessionStorage.getItem(keys.admission), serverSessionKeys(eu))).toBe('eu-ticket-must-not-be-sent');
    await expect(europe.locator('.connection-indicator')).toHaveAttribute('data-connection', 'connected');
    expect(errors).toEqual([]);
  } finally {
    if (peer?.connection.isOpen) await peer.leave();
    for (const page of pages) await page.evaluate(() => window.sdpUnified?.network.disconnect()).catch(() => {});
    for (const context of contexts) await context.close();
  }
});

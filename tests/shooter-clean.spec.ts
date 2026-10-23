import { test, expect } from '@playwright/test';
import type { GameModeManager } from '../src/modes/GameModeManager';
import type { ColyseusNetworkAdapter } from '../src/network/ColyseusNetworkAdapter';

test('clean Shooter has no rewards, tactical map or digit shortcuts; shooting and ranking remain usable', async ({ page }, info) => {
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.goto('/?debugMode=shooter', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'SHOOTER', { timeout: 90000 });
  await page.getByRole('button', { name: 'ENTER SIMULATION', exact: true }).click();
  for (const key of ['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3']) await page.keyboard.press(key);
  await expect(page.locator('.mode-overlay')).toBeHidden();
  await expect(page.locator('.streak-meter, .shooter-strike, .strike-status, .targeting-map, .kill-announcement')).toHaveCount(0);
  const state = await page.evaluate(() => {
    const app = (window as unknown as { sdpUnified: { modes: GameModeManager; network: ColyseusNetworkAdapter } }).sdpUnified;
    const s = app.modes.shooter!, local = app.network.snapshot!.players.find(p => p.playerId === app.network.snapshot!.localPlayerId)!;
    return { controlling: s.input.controlling, paused: s.paused, visible: s.weapon.root.visible,
      targeting: 'targeting' in s, airstrikes: 'airstrikes' in s, streak: 'streak' in local, strikes: 'strikes' in local };
  });
  expect(state).toEqual({ controlling: true, paused: false, visible: true, targeting: false, airstrikes: false, streak: false, strikes: false });
  await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up();
  await expect(page.locator('.shooter-magazine')).toHaveText('29');
  await page.keyboard.press('KeyP');
  const table = page.getByRole('table', { name: 'Room scores' });
  await expect(table.getByRole('columnheader')).toHaveCount(4);
  await expect(table).not.toContainText(/STRIKE|STREAK/);
  await page.screenshot({ path: info.outputPath('clean-shooter-menu.png') });
  await page.getByRole('button', { name: 'RETURN TO LIMBO', exact: true }).click();
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'LIMBO');
  expect(requests.some(url => /\/strikes\/|Airstrike|TargetingMap|Aircraft/.test(url))).toBe(false);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.sdpUnified.network.disconnect());
});

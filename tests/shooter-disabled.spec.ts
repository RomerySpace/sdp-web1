import { test, expect } from '@playwright/test';
test('backend flag hides inspection access and blocks debug, direct UI calls and matchmaking', async ({ page }) => {
  const requests: string[] = []; page.on('request', r => requests.push(r.url()));
  await page.goto('/?debugMode=shooter');
  await expect(page.locator('.ui')).toHaveAttribute('data-sculpture', 'loaded');
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'LIMBO');
  await page.goto('/?debugMode=limbo');
  await page.getByRole('button', { name: 'CLICK TO ENTER' }).click();
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  await page.evaluate(() => { const camera = window.sdpUnified.player.camera; camera.position.set(0, 1.7, 2.7); camera.rotation.set(0, 0, 0); });
  await page.keyboard.press('KeyE'); await expect(page.locator('.ui')).toHaveAttribute('data-state', 'INSPECTING');
  await expect(page.getByRole('button', { name: 'JOIN SHOOTER TEST', exact: true })).toBeHidden();
  await page.evaluate(() => window.sdpUnified.modes.joinShooter());
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'LIMBO');
  expect(requests.filter(url => /\/shooter\/|\/modes\/shooter\/|rapier3d/.test(url))).toEqual([]);
  const response = await page.request.post('/multiplayer/matchmake/joinOrCreate/SDPShooterRoom', { data: {} });
  expect(await response.json()).toMatchObject({ code: 403, error: 'Shooter test is disabled.' });
  await page.keyboard.press('KeyE'); await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
});

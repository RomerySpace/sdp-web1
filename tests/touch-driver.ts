import { expect, type Page } from '@playwright/test';

export async function touchDriver(page: Page) {
  const session = await page.context().newCDPSession(page);
  const points = new Map<number, { id: number; x: number; y: number; radiusX: number; radiusY: number; force: number }>();
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel') => session.send('Input.dispatchTouchEvent', { type, touchPoints: [...points.values()] });
  return {
    async down(id: number, x: number, y: number) { points.set(id, { id, x, y, radiusX: 2, radiusY: 2, force: 1 }); await send('touchStart'); },
    async move(id: number, x: number, y: number) { const point = points.get(id)!; point.x = x; point.y = y; await send('touchMove'); },
    async up(id: number) {
      const point = points.get(id); if (!point) return;
      points.delete(id);
      // A partial CDP touchEnd identifies the released contact, not those still held.
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: points.size ? [point] : [] });
    },
    async cancel() { points.clear(); await send('touchCancel'); },
  };
}
export async function walkToSculpture(page: Page): Promise<void> {
  await expect(page.locator('.touch-stick')).toBeVisible();
  const box = (await page.locator('.touch-stick').boundingBox())!, driver = await touchDriver(page);
  await driver.down(1, box.x + box.width / 2, box.y + box.height / 2);
  await driver.move(1, box.x + box.width / 2, box.y + box.height * .05);
  try { await expect(page.getByRole('button', { name: 'Interact with sculpture', exact: true })).toBeVisible({ timeout: 15000 }); }
  finally { await driver.up(1); }
  await page.getByRole('button', { name: 'Interact with sculpture', exact: true }).tap();
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'INSPECTING');
}

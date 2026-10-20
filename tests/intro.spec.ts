import { test, expect } from '@playwright/test';

for (const [name, width, height, touch] of [
  ['desktop', 1440, 1000, false], ['mobile', 390, 844, true],
  ['small', 320, 568, true], ['landscape', 844, 390, true],
] as const) {
  test(`release entry: ${name} layout, identity and lazy loading`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
    const page = await context.newPage(), errors: string[] = [], requests: string[] = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
    try {
      await page.goto(baseURL!);
      await expect(page).toHaveTitle('SDP — A Shared Presence');
      await expect(page.getByRole('heading', { name: 'SDP', exact: true })).toBeVisible();
      const enter = page.getByRole('button', { name: 'CLICK TO ENTER', exact: true }); await expect(enter).toBeEnabled();
      await expect(page.locator('.intro-object, .intro-index, .intro-footer')).toHaveCount(0);
      await expect(page.locator('.intro')).not.toContainText(/PROTOTYPE|LOCAL TEST/);
      await page.screenshot({ path: `/private/tmp/sdp-intro-${name}.png`, animations: 'disabled' });
      await enter.click();
      const field = page.getByRole('textbox', { name: 'USERNAME', exact: true });
      await expect(field).toBeFocused(); await field.fill('SDP visitor');
      await page.screenshot({ path: `/private/tmp/sdp-name-${name}.png`, animations: 'disabled' });
      const box = (await page.locator('.intro-name-form').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.y + box.height).toBeLessThanOrEqual(height);
      const identity = (await page.locator('.intro-identity').boundingBox())!;
      expect(identity.y + identity.height).toBeLessThan(box.y);
      expect(requests.some(url => url.includes('entry-object.webp'))).toBe(false);
      expect(requests.some(url => /ShooterMode|dust2plainmap|shooter-physics/.test(url))).toBe(false);
      if (name === 'desktop' || name === 'mobile') {
        await page.getByRole('button', { name: 'ENTER', exact: true }).click();
        await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
        await expect(page.locator('.intro')).toBeHidden();
        await expect(page.locator('.connection-indicator')).toHaveAttribute('data-connection', 'connected');
      }
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}

import { expect, type Page } from '@playwright/test';
export async function submitName(page: Page, name = 'SDP Tester'): Promise<void> {
  await page.getByRole('button', { name: /^(CLICK TO ENTER|VIEW EXHIBITION)$/ }).click();
  await page.getByRole('textbox', { name: 'USERNAME', exact: true }).fill(name);
  await page.getByRole('button', { name: 'ENTER', exact: true }).click();
}
export async function enterExhibition(page: Page, name = 'SDP Tester'): Promise<void> {
  await submitName(page, name);
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  await expect(page.locator('.connection-indicator')).toHaveAttribute('data-connection', 'connected');
}

import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('a supplied ambient asset starts only on entry, loops, fades and responds to volume', async ({ page }) => {
  test.skip(!existsSync('public/audio/ambient.mp3'), 'The ambient asset is optional; provide it to exercise playback.');
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect as (this: AudioNode, destination: AudioNode | AudioParam, output?: number, input?: number) => AudioNode | void;
    AudioNode.prototype.connect = function (this: AudioNode, destination: AudioNode | AudioParam, output?: number, input?: number) {
      if (destination instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        connect.call(this, analyser);
        Object.assign(window, { audioProbe: { analyser, context: this.context } });
      }
      if (destination instanceof AudioNode) return connect.call(this, destination, output ?? 0, input ?? 0);
      connect.call(this, destination, output ?? 0);
    } as typeof AudioNode.prototype.connect;
  });
  await page.goto('/');
  await expect(page.locator('.ui')).toHaveAttribute('data-hdr', 'loaded');
  expect(await page.evaluate(() => 'audioProbe' in window)).toBe(false);
  await page.getByRole('button', { name: 'CLICK TO ENTER' }).click();
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');

  const level = () => page.evaluate(() => {
    const probe = (window as unknown as { audioProbe?: { analyser: AnalyserNode } }).audioProbe;
    if (!probe) return 0;
    const samples = new Float32Array(2048);
    probe.analyser.getFloatTimeDomainData(samples);
    return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
  });
  await expect.poll(level).toBeGreaterThan(0.0001);
  await page.evaluate(() => document.exitPointerLock());
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'PAUSED');
  await page.getByRole('button', { name: 'Mute ambient sound' }).click();
  await expect.poll(level).toBeLessThan(0.00001);
  await page.getByRole('button', { name: 'Unmute ambient sound' }).click();
  await expect.poll(level).toBeGreaterThan(0.0001);
  // Range change goes through the visible HTML control's normal input event.
  await page.getByRole('slider', { name: 'Ambient volume' }).press('Home');
  await expect.poll(level).toBeLessThan(0.00001);
  await page.getByRole('slider', { name: 'Ambient volume' }).press('End');
  await expect.poll(level).toBeGreaterThan(0.0001);
  // The fixture is one second long: playback after this delay verifies looping.
  await page.waitForTimeout(1600);
  await expect.poll(level).toBeGreaterThan(0.0001);
});

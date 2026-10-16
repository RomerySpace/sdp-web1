import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import type { InstancedMesh, Mesh, MeshStandardMaterial, PlaneGeometry, ShaderMaterial } from 'three';
import { enterExhibition } from './entry';
import { walkToSculpture } from './touch-driver';
import { sessionRanking } from '../src/modes/shooter/ui/SessionRanking';
import { createMonolithGeometry, createUpperMonolithGeometry } from '../src/scene/MonolithGeometry';
import type { NetworkPlayer } from '../shared/MultiplayerProtocol';
import type { GameModeManager } from '../src/modes/GameModeManager';
import type { ColyseusNetworkAdapter } from '../src/network/ColyseusNetworkAdapter';
import type { SceneManager } from '../src/scene/SceneManager';
import type { FirstPersonController } from '../src/player/FirstPersonController';
import type { LiveKitVoiceTransport } from '../src/audio/LiveKitVoiceTransport';
import type { ShooterMode } from '../src/modes/shooter/ShooterMode';
import type { AudioManager } from '../src/audio/AudioManager';
declare global { interface Window {
  sdpUnified: { modes: GameModeManager; network: ColyseusNetworkAdapter; scene: SceneManager; player: FirstPersonController; voiceTransport: LiveKitVoiceTransport; audio: AudioManager };
  retiredShooter?: ShooterMode;
  audioContexts: number;
  createdAudioContexts: AudioContext[];
  ambientMeter?: AnalyserNode;
  shooterMotionSamples: { time: number; x: number; y: number; z: number }[];
} }
const shooterRequest = (url: string): boolean => /\/shooter\/|\/modes\/shooter\/|ShooterMode-|shooter-physics-|rapier3d/.test(url);
async function enterLimbo(page: Page): Promise<void> {
  await page.goto('/?debugMode=limbo');
  await expect(page.locator('.ui')).toHaveAttribute('data-sculpture', 'loaded');
  await enterExhibition(page);
}
async function openProtocol(page: Page): Promise<void> {
  await page.evaluate(() => { const camera = window.sdpUnified.player.camera; camera.position.set(0, 1.7, 2.7); camera.rotation.set(0, 0, 0); });
  await expect(page.getByRole('button', { name: 'Interact with sculpture' })).toBeVisible();
  await page.keyboard.press('KeyE');
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'INSPECTING');
  await expect(page.locator('.mode-overlay')).toBeHidden();
}
async function enterShooter(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'JOIN SHOOTER', exact: true }).click();
  // Three concurrent headless GPU contexts can compile a cold scene slowly.
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'SHOOTER', { timeout: 90000 });
  await page.getByRole('button', { name: 'ENTER SIMULATION' }).click();
  await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter?.paused)).toBe(false);
}
async function visiblePixels(page: Page): Promise<number> {
  const { data, info } = await sharp(await page.locator('canvas.scene-canvas').screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let contrast = 0;
  for (let i = 0; i < data.length; i += info.channels) if (Math.min(data[i], data[i + 1], data[i + 2]) < 210) contrast++;
  return contrast;
}
async function canvasContrast(page: Page): Promise<number> {
  return page.evaluate(() => {
    const scene = window.sdpUnified.scene, renderer = scene.renderer;
    renderer.render(scene.scene, scene.camera);
    const gl = renderer.getContext(), pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let contrast = 0;
    for (let i = 0; i < pixels.length; i += 4) if (Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 250) contrast++;
    return contrast;
  });
}
for (const mobile of [false, true]) {
  test(`white lobby ground and continuous grass fade into a dark horizon (${mobile ? 'mobile' : 'desktop'})`, async ({ browser }, info) => {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      isMobile: mobile, hasTouch: mobile,
    });
    try {
      const page = await context.newPage(), errors: string[] = [], requests: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error' && /shader|WebGLProgram|GL_INVALID/.test(message.text())) errors.push(message.text()); });
      page.on('request', request => requests.push(request.url()));
      await enterLimbo(page);
      await expect.poll(() => page.evaluate(() => {
        const backdrop = window.sdpUnified.scene.scene.children.find(object => object.renderOrder === -1000) as Mesh<PlaneGeometry, ShaderMaterial>;
        return backdrop.material.uniforms.atmosphereReveal.value;
      })).toBe(1);
      const palette = await page.evaluate(() => {
        const { scene, renderer, camera } = window.sdpUnified.scene;
        const floor = scene.children.find(object => object.type === 'Mesh'
          && (object as Mesh<PlaneGeometry>).geometry.parameters?.width === 2000) as Mesh<PlaneGeometry, MeshStandardMaterial>;
        const grass = scene.children.filter(object => object.name.startsWith('White grass')) as InstancedMesh[];
        const shaders: { vertex: string; horizon: number[] }[] = [];
        // Capture the shaders actually compiled by WebGL, not a source-text fixture.
        for (const field of grass) {
          const material = field.material as MeshStandardMaterial, compile = material.onBeforeCompile.bind(material);
          const cacheKey = material.customProgramCacheKey();
          material.onBeforeCompile = (shader, webgl) => {
            compile(shader, webgl);
            shaders.push({ vertex: shader.vertexShader, horizon: shader.uniforms.atmosphereHorizon.value.toArray() });
          };
          material.customProgramCacheKey = () => `${cacheKey}-palette-test`;
          material.needsUpdate = true;
        }
        renderer.render(scene, camera);
        const base = scene.getObjectByName('Monolith / satin foundation') as Mesh<PlaneGeometry, MeshStandardMaterial>;
        const column = scene.getObjectByName('Nebula / infinite upper monolith') as Mesh<PlaneGeometry, MeshStandardMaterial>;
        let sharedHorizon = false;
        const compile = column.material.onBeforeCompile.bind(column.material), cacheKey = column.material.customProgramCacheKey();
        column.material.onBeforeCompile = (shader, webgl) => { compile(shader, webgl); sharedHorizon = shader.uniforms.atmosphereHorizon === window.sdpUnified.scene.atmosphere.horizon; };
        column.material.customProgramCacheKey = () => `${cacheKey}-upper-test`;column.material.needsUpdate = true;renderer.render(scene, camera);
        return {
          floor: floor.material.color.r, grass: grass.map(field => (field.material as MeshStandardMaterial).color.getHexString()), shaders,
          base: { visible: base.visible, color: base.material.color.getHexString(), bottom: base.geometry.boundingBox!.min.y + base.position.y, top: base.geometry.boundingBox!.max.y + base.position.y },
          sharedHorizon,
          upperFinish: column.material.color.getHexString(), matchingFinish: column.material.roughness === base.material.roughness,
          lowerCloud: !!scene.getObjectByName('Nebula / lower monolith'),
        };
      });
      expect(palette.floor).toBeCloseTo(.95); expect(palette.grass).toEqual(['ffffff', 'ffffff']);
      expect(palette.base.visible).toBe(true); expect(palette.base.color).toBe('ffffff');
      expect(palette.base.bottom).toBeLessThan(0); expect(palette.base.top).toBeCloseTo(1.2, 5);
      expect(palette.sharedHorizon).toBe(true); expect(palette.lowerCloud).toBe(false);
      expect(palette.upperFinish).toBe(palette.base.color);expect(palette.matchingFinish).toBe(true);
      expect(palette.shaders).toHaveLength(2);
      for (const shader of palette.shaders) {
        expect(shader.vertex).toContain('transformed *= root * fieldFade;');
        expect(shader.vertex).not.toMatch(/float path|root \* path/);
        expect(shader.horizon).toEqual([.20, .23, .27]);
      }
      await page.addStyleTag({ content: '.mode-diagnostics { visibility: hidden !important; }' });
      await page.screenshot({ path: info.outputPath('white-lobby.png') });
      await page.addStyleTag({ content: '.ui, .touch-controls { visibility: hidden !important; }' });
      const { data, info: pixels } = await sharp(await page.locator('canvas.scene-canvas').screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const brightness = (top: number, bottom: number): number => {
        let sum = 0, count = 0;
        for (let y = Math.floor(pixels.height * top); y < pixels.height * bottom; y++) {
          for (let x = Math.floor(pixels.width * .75); x < pixels.width * .90; x++) {
            const offset = (y * pixels.width + x) * pixels.channels;
            sum += (data[offset] + data[offset + 1] + data[offset + 2]) / 3; count++;
          }
        }
        return sum / count;
      };
      const foreground = brightness(.75, .90), horizon = brightness(.44, .49);
      expect(foreground).toBeGreaterThan(170); expect(horizon).toBeLessThan(100);
      expect(foreground - horizon).toBeGreaterThan(60);
      expect(requests.filter(shooterRequest)).toEqual([]); expect(errors).toEqual([]);
      const zenith = await page.evaluate(() => {
        const { scene, renderer, camera } = window.sdpUnified.scene;
        window.sdpUnified.player.setEnabled(false);
        camera.position.set(0, 1.7, 24); camera.lookAt(0, 38, 0); camera.updateMatrixWorld();
        const tower = scene.getObjectByName('Nebula / infinite upper monolith')!;
        const gl = renderer.getContext();
        const sample = (height: number) => {
          const projected = camera.position.clone().set(0, height, 0).project(camera), pixel = new Uint8Array(4);
          gl.readPixels(Math.floor((projected.x + 1) * .5 * gl.drawingBufferWidth), Math.floor((projected.y + 1) * .5 * gl.drawingBufferHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          return [...pixel];
        };
        renderer.render(scene, camera); const high = sample(80), middle = sample(20);
        tower.visible = false; renderer.render(scene, camera); const backgroundHigh = sample(80), backgroundMiddle = sample(20);
        tower.visible = true; renderer.render(scene, camera);
        return { high: high.reduce((sum, value, i) => sum + Math.abs(value - backgroundHigh[i]), 0), middle: middle.reduce((sum, value, i) => sum + Math.abs(value - backgroundMiddle[i]), 0) };
      });
      expect(zenith.high).toBeLessThanOrEqual(3); expect(zenith.middle).toBeGreaterThan(3);
      await page.screenshot({ path: info.outputPath('monolith-zenith.png') });
    } finally { await context.close(); }
  });
}
test('actual MP3 waits for entry, plays from above, attenuates with distance and fades out in Shooter', async ({ page }) => {
  const requests: string[] = []; page.on('request', request => requests.push(request.url()));
  await page.goto('/?debugMode=limbo');
  await expect(page.locator('.ui')).toHaveAttribute('data-sculpture', 'loaded');
  expect(requests.filter(url => url.endsWith('.mp3'))).toEqual([]);
  await enterExhibition(page, 'Ambient Audio');
  await expect(page.locator('.now-playing')).toBeVisible();
  expect(requests.some(url => url.includes('/audio/music/steve-hauschildt-time-we-have.mp3'))).toBe(true);
  expect(requests.filter(shooterRequest)).toEqual([]);
  const playback = await page.evaluate(() => {
    const audio = window.sdpUnified.audio as unknown as { media: HTMLAudioElement; panner: PannerNode; ambience: GainNode; context: AudioContext };
    const analyser = audio.context.createAnalyser(); audio.ambience.connect(analyser);
    Object.assign(window, { ambientMeter: analyser });
    window.sdpUnified.player.setEnabled(false); window.sdpUnified.scene.camera.position.set(0, 1.7, 2.7);
    return { duration: audio.media.duration, paused: audio.media.paused, height: audio.panner.positionY.value, spatial: audio.panner.panningModel };
  });
  expect(playback.duration).toBeCloseTo(353.28, 1); expect(playback.paused).toBe(false);
  expect(playback.height).toBe(14); expect(playback.spatial).toBe('HRTF');
  const ambientGain = () => page.evaluate(() => (window.sdpUnified.audio as unknown as { ambience: GainNode }).ambience.gain.value);
  await expect.poll(ambientGain).toBeGreaterThan(.98);
  await expect.poll(() => page.evaluate(() => {
    const analyser = window.ambientMeter!;
    const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
    return Math.max(...samples.map(Math.abs));
  })).toBeGreaterThan(.0001);
  await page.evaluate(() => window.sdpUnified.scene.camera.position.set(0, 1.7, 50));
  await expect.poll(ambientGain).toBeLessThan(.23); expect(await ambientGain()).toBeGreaterThan(.20);
  await page.evaluate(() => { window.sdpUnified.scene.camera.position.set(0, 1.7, 2.7); window.sdpUnified.player.setEnabled(true); });
  await openProtocol(page); expect(requests.filter(shooterRequest)).toEqual([]);
  await enterShooter(page); await expect.poll(ambientGain).toBeLessThan(.001);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'RETURN TO LIMBO' }).click();
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'LIMBO');
  await expect.poll(ambientGain).toBeGreaterThan(.2);
});

test('organic monolith has a flared, buried foot, smooth normals and the original collision footprint', () => {
  const geometry = createMonolithGeometry();
  try {
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
    const bounds = geometry.boundingBox!;
    expect(bounds.min.y).toBeLessThan(0); expect(bounds.max.y).toBeCloseTo(1.2, 5);
    expect(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.min.z), bounds.max.x, bounds.max.z)).toBeLessThanOrEqual(1.2);
    expect(positions.count).toBeLessThan(4000); expect(geometry.index!.count / 3).toBeLessThan(6500);
    let foot = 0, waist = 0;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      expect([x, y, z].every(Number.isFinite)).toBe(true);
      expect(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i))).toBeCloseTo(1, 5);
      if (y < .1) foot = Math.max(foot, Math.abs(x), Math.abs(z));
      if (y > .45 && y < .85) waist = Math.max(waist, Math.abs(x), Math.abs(z));
    }
    expect(foot - waist).toBeGreaterThan(.15);
    expect(normals.getY(positions.count - 1)).toBeCloseTo(1, 5);
  } finally { geometry.dispose(); }
});
test('upper monolith mirrors the lower organic profile and leaves the weapon aperture clear', () => {
  const lower = createMonolithGeometry(), upper = createUpperMonolithGeometry();
  try {
    const a = lower.getAttribute('position'), b = upper.getAttribute('position'), n = upper.getAttribute('normal'), sides = 72, rings = 40;
    for(let ring=0;ring<=rings;ring++)for(let side=0;side<sides;side++) {
      const i=ring*sides+side,j=(rings-ring)*sides+side;
      expect(b.getX(i)).toBeCloseTo(a.getX(j),5);expect(b.getZ(i)).toBeCloseTo(a.getZ(j),5);expect(b.getY(i)+a.getY(j)).toBeCloseTo(1.2,5);
      expect(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))).toBeCloseTo(1,5);
    }
    expect(upper.boundingBox!.min.y+2.85).toBeCloseTo(2.85);expect(upper.boundingBox!.max.y).toBe(300);
    expect(b.count).toBeLessThan(4000);expect(upper.index!.count/3).toBeLessThan(6500);
    expect(n.getY(b.count-2)).toBeCloseTo(-1,5);
  }finally{lower.dispose();upper.dispose();}
});
test('session ranking uses authoritative kills then deaths and excludes disconnected players', () => {
  const player = (playerId: string, kills: number, deaths: number, connected = true): NetworkPlayer => ({
    playerId, kills, deaths, connected, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, lastProcessedInput: 0,
  });
  const players = [player('c', 3, 5), player('b', 3, 2), player('a', 3, 2), player('d', 4, 8), player('e', 10, 0, false)];
  expect(sessionRanking(players).map(player => player.playerId)).toEqual(['d', 'a', 'b', 'c']);
  expect(players[0].playerId).toBe('c');
});
test('P opens a live room scoreboard with persistent, functional sensitivity and audio controls', async ({ page }, info) => {
  await enterLimbo(page); await openProtocol(page); await enterShooter(page);
  await expect(page.locator('.shooter-menu-button')).toContainText('P');
  await expect(page.locator('.shooter-fire-hint')).toContainText('B');
  await page.keyboard.down('KeyW'); await page.waitForTimeout(250); await page.keyboard.press('KeyP'); await page.keyboard.up('KeyW');
  await expect(page.getByRole('table', { name: 'Room scores' })).toBeVisible();
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  expect(await page.evaluate(() => window.sdpUnified.modes.shooter!.input.enabled)).toBe(false);
  const steps = await page.evaluate(() => window.sdpUnified.modes.shooter!.fixedSteps);
  await page.waitForTimeout(200); expect(await page.evaluate(() => window.sdpUnified.modes.shooter!.fixedSteps)).toBe(steps);
  await expect(page.locator('.session-ranking tbody tr')).toHaveCount(1);
  await expect(page.locator('.session-ranking tbody tr[data-local="true"] td:nth-child(2)')).toHaveText('SDP Tester');
  await page.getByRole('slider', { name: 'Mouse sensitivity' }).press('End');
  expect(await page.evaluate(() => window.sdpUnified.modes.shooter!.input.sensitivity)).toBe(2.5);
  expect(await page.evaluate(() => localStorage.getItem('sdp:sensitivity'))).toBe('2.5');
  await page.getByRole('slider', { name: 'Game volume' }).press('Home'); await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window.sdpUnified.modes.shooter!.audio as unknown as { gain: GainNode }).gain.gain.value)).toBeLessThan(.001);
  await page.getByRole('slider', { name: 'Game volume' }).press('End');
  await page.getByRole('button', { name: 'Mute audio', exact: true }).click(); await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window.sdpUnified.modes.shooter!.audio as unknown as { gain: GainNode }).gain.gain.value)).toBeLessThan(.001);
  await page.getByRole('button', { name: 'Unmute audio', exact: true }).click(); await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window.sdpUnified.modes.shooter!.audio as unknown as { gain: GainNode }).gain.gain.value)).toBeGreaterThan(.65);
  await page.screenshot({ path: info.outputPath('session-menu-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const controls = await page.getByRole('button', { name: 'RETURN TO LIMBO' }).boundingBox();
  expect(controls!.y + controls!.height).toBeLessThan(844);
  await page.screenshot({ path: info.outputPath('session-menu-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('slider', { name: 'Mouse sensitivity' }).focus();
  await page.keyboard.press('KeyP'); await expect(page.locator('.mode-overlay')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter!.input.enabled && window.sdpUnified.modes.shooter!.input.locked)).toBe(true);
  expect(await page.evaluate(() => document.activeElement instanceof HTMLInputElement)).toBe(false);
  const yaw = await page.evaluate(() => window.sdpUnified.modes.shooter!.input.yaw);
  await page.mouse.move(770, 500, { steps: 4 }); await page.mouse.move(870, 500, { steps: 4 });
  expect(Math.abs(await page.evaluate(() => window.sdpUnified.modes.shooter!.input.yaw) - yaw)).toBeGreaterThan(0);
  await page.keyboard.press('Enter'); await page.getByRole('textbox', { name: 'Chat message' }).press('p');
  await expect(page.getByRole('textbox', { name: 'Chat message' })).toHaveValue('p');
  await expect(page.locator('.mode-overlay')).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByRole('textbox', { name: 'Chat message' })).toBeHidden();
  await expect(page.getByRole('table', { name: 'Room scores' })).toBeVisible();
  await page.keyboard.press('KeyP'); await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter!.input.enabled)).toBe(true);
  await page.keyboard.press('KeyP'); await page.getByRole('button', { name: 'RETURN TO LIMBO' }).click();
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'LIMBO');
  expect(await page.evaluate(() => window.sdpUnified.player.sensitivity)).toBe(2.5);
  await page.reload(); await enterExhibition(page);
  expect(await page.evaluate(() => window.sdpUnified.player.sensitivity)).toBe(2.5);
  await page.keyboard.press('KeyP');
  await expect(page.getByRole('slider', { name: 'Game volume' })).toHaveValue('1');
});
test('shared settings and F work in entry, Limbo, inspection and Shooter without premature loading', async ({ page }, info) => {
  const requests: string[] = []; page.on('request', request => requests.push(request.url()));
  const fullscreen = () => page.evaluate(() => Boolean(document.fullscreenElement));
  await page.goto('/?debugMode=limbo');
  await expect(page.getByRole('button', { name: 'CLICK TO ENTER' })).toBeEnabled();
  await expect(page.locator('.top-controls button, .audio-control, .volume-control, .fullscreen-button')).toHaveCount(0);
  await page.keyboard.press('KeyF'); await expect.poll(fullscreen).toBe(true);
  await page.keyboard.press('KeyF'); await expect.poll(fullscreen).toBe(false);
  await page.getByRole('button', { name: 'CLICK TO ENTER' }).click();
  await page.getByRole('textbox', { name: 'USERNAME', exact: true }).press('f');
  expect(await fullscreen()).toBe(false);
  await page.getByRole('textbox', { name: 'USERNAME', exact: true }).fill('Settings Tester');
  await page.getByRole('button', { name: 'ENTER', exact: true }).click();
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  const room = await page.evaluate(() => window.sdpUnified.network.status.roomId);
  await page.keyboard.press('KeyF'); await expect.poll(fullscreen).toBe(true);
  await page.keyboard.press('KeyF'); await expect.poll(fullscreen).toBe(false);
  if (await page.getByRole('button', { name: 'CLICK TO RESUME' }).isVisible()) await page.getByRole('button', { name: 'CLICK TO RESUME' }).click();
  await page.keyboard.press('KeyP'); await expect(page.getByRole('dialog', { name: 'Limbo settings' })).toBeVisible();
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
  await page.getByRole('slider', { name: 'Music volume' }).press('Home');
  await expect(page.getByRole('slider', { name: 'Game volume' })).toHaveValue('0.5');
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('KeyF'); await expect.poll(fullscreen).toBe(false);
  await page.screenshot({ path: info.outputPath('limbo-settings-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('limbo-settings-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const close = await page.getByRole('button', { name: 'RETURN P', exact: true }).boundingBox(); expect(close!.y + close!.height).toBeLessThan(844);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press('KeyP'); await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  await page.keyboard.press('Enter'); await page.getByRole('textbox', { name: 'Chat message' }).press('f');
  expect(await fullscreen()).toBe(false); await expect(page.getByRole('textbox', { name: 'Chat message' })).toHaveValue('f');
  await page.keyboard.press('Escape'); await openProtocol(page);
  const distance = await page.evaluate(() => window.sdpUnified.scene.inspection.distance);
  await page.getByRole('button', { name: 'Open Limbo settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'JOIN SHOOTER' })).toBeHidden();
  await page.getByRole('button', { name: 'RETURN P', exact: true }).click();
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'INSPECTING');
  expect(await page.evaluate(() => window.sdpUnified.scene.inspection.distance)).toBeCloseTo(distance);
  await page.keyboard.press('KeyF'); await expect.poll(fullscreen).toBe(true);
  await page.keyboard.press('KeyF'); await expect.poll(fullscreen).toBe(false);
  expect(await page.evaluate(() => window.sdpUnified.network.status.roomId)).toBe(room);
  expect(requests.filter(shooterRequest)).toEqual([]);
  await enterShooter(page);
  await page.keyboard.press('KeyF'); await expect.poll(fullscreen).toBe(true);
  await page.keyboard.press('KeyF'); await expect.poll(fullscreen).toBe(false);
  if (await page.locator('.mode-overlay').isHidden()) await page.keyboard.press('KeyP');
  await expect(page.getByRole('slider', { name: 'Music volume' })).toHaveValue('0');
  await page.getByRole('slider', { name: 'Music volume' }).press('End');
  await expect(page.getByRole('slider', { name: 'Game volume' })).toHaveValue('0.5');
  expect(await page.evaluate(() => (window.sdpUnified.modes.shooter!.audio as unknown as { volume: number }).volume)).toBe(.5);
  await page.getByRole('button', { name: 'Enter fullscreen' }).click(); await expect.poll(fullscreen).toBe(true);
  await page.getByRole('button', { name: 'Exit fullscreen' }).click(); await expect.poll(fullscreen).toBe(false);
  await page.getByRole('button', { name: 'RETURN TO LIMBO' }).click();
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'LIMBO');
  await page.reload(); await enterExhibition(page); await page.keyboard.press('KeyP');
  await expect(page.getByRole('slider', { name: 'Music volume' })).toHaveValue('1');
  await expect(page.getByRole('slider', { name: 'Game volume' })).toHaveValue('0.5');
  expect(requests.filter(url => /\/audio\/ambient\.mp3/.test(url))).toEqual([]);
});
test('entry stays white before choosing a name and does not request Shooter resources', async ({ page }, info) => {
  const requests: string[] = []; page.on('request', request => requests.push(request.url()));
  await page.goto('/?debugMode=limbo');
  await expect(page.getByRole('button', { name: 'CLICK TO ENTER' })).toBeEnabled();
  expect(await canvasContrast(page)).toBe(0);
  expect(await page.evaluate(() => window.sdpUnified.network.status.state)).toBe('disconnected');
  await page.getByRole('button', { name: 'CLICK TO ENTER' }).click();
  await expect(page.getByRole('textbox', { name: 'USERNAME', exact: true })).toBeVisible();
  expect(await canvasContrast(page)).toBe(0);
  await page.screenshot({ path: info.outputPath('white-name-entry.png') });
  await page.getByRole('textbox', { name: 'USERNAME', exact: true }).fill('<script>');
  await page.getByRole('button', { name: 'ENTER', exact: true }).click();
  await expect(page.locator('#intro-name-message')).toContainText('2-20');
  await page.getByRole('textbox', { name: 'USERNAME', exact: true }).fill('Named Visitor');
  await page.getByRole('button', { name: 'ENTER', exact: true }).click();
  await expect(page.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
  await expect.poll(() => page.evaluate(() => window.sdpUnified.network.snapshot?.players[0].displayName)).toBe('Named Visitor');
  expect(await visiblePixels(page)).toBeGreaterThan(300);
  expect(requests.filter(shooterRequest)).toEqual([]);
  await page.screenshot({ path: info.outputPath('named-visitor-reveal.png') });
});
test('B toggles authoritative automatic fire; holding fires a rising burst, release stops and typing is ignored', async ({ page }, info) => {
  await enterLimbo(page); await openProtocol(page); await enterShooter(page);
  await page.keyboard.press('KeyB');
  await expect(page.locator('.shooter-fire-mode')).toHaveText('SDP / AUTO');
  await expect.poll(() => page.evaluate(() => {
    const s = window.sdpUnified.network.snapshot!; return s.players.find(p => p.playerId === s.localPlayerId)!.automatic;
  })).toBe(true);
  const pitch = await page.evaluate(() => window.sdpUnified.modes.shooter!.input.pitch);
  await page.mouse.down(); await page.waitForTimeout(680); await page.mouse.up();
  const burst = await page.evaluate(() => { const game = window.sdpUnified.modes.shooter!; return { shots: game.shooting!.shotsFired, pitch: game.input.pitch }; });
  expect(burst.shots).toBeGreaterThanOrEqual(5); expect(burst.pitch - pitch).toBeGreaterThan(.07);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.sdpUnified.modes.shooter!.shooting!.shotsFired)).toBe(burst.shots);
  await page.screenshot({ path: info.outputPath('automatic-recoil.png') });
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Chat message' }).press('b');
  expect(await page.evaluate(() => window.sdpUnified.modes.shooter!.weapon.automatic)).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('.mode-overlay')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter!.input.enabled && window.sdpUnified.modes.shooter!.input.locked)).toBe(true);
  await page.keyboard.press('KeyB'); await expect(page.locator('.shooter-fire-mode')).toHaveText('SDP / SEMI-AUTO');
  const before = await page.evaluate(() => window.sdpUnified.modes.shooter!.shooting!.shotsFired);
  await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.up();
  expect(await page.evaluate(() => window.sdpUnified.modes.shooter!.shooting!.shotsFired)).toBe(before + 1);
});
test('two actual browsers: authoritative hits, crouch, digital death and server respawn', async ({ browser }, info) => {
  const a = await browser.newContext(), b = await browser.newContext(), first = await a.newPage(), second = await b.newPage();
  const errors: string[] = [];
  for (const page of [first, second]) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /THREE|shader|WebGL/i.test(message.text())) errors.push(message.text()); });
  }
  const targetState = () => second.evaluate(() => { const s = window.sdpUnified.network.snapshot!; return s.players.find(p => p.playerId === s.localPlayerId)!; });
  try {
    await enterLimbo(first); await openProtocol(first); await enterShooter(first);
    await enterLimbo(second); await openProtocol(second); await enterShooter(second);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.modes.shooter!.remotes.count)).toBe(1);
    await second.keyboard.down('ControlLeft');
    await expect.poll(async () => (await targetState()).height).toBeLessThan(1.3);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.modes.shooter!.remotes.group.children[0].userData.height)).toBeLessThan(1.3);
    expect(await first.evaluate(() => window.sdpUnified.modes.shooter!.remotes.group.children[0].scale.y)).toBe(1);
    await second.keyboard.up('ControlLeft'); await expect.poll(async () => (await targetState()).height).toBeGreaterThan(1.7);
    await first.bringToFront(); if (await first.getByRole('button', { name: 'RESUME', exact: true }).isVisible()) await first.getByRole('button', { name: 'RESUME', exact: true }).click();
    await expect.poll(() => first.evaluate(() => window.sdpUnified.modes.shooter!.input.enabled && window.sdpUnified.modes.shooter!.input.locked)).toBe(true);
    await expect.poll(() => second.evaluate(() => { const s = window.sdpUnified.network.snapshot!, p = s.players.find(p => p.playerId === s.localPlayerId)!; return s.serverTime! - p.protectedUntil!; })).toBeGreaterThan(200);
    await first.evaluate(() => {
      const app = window.sdpUnified, s = app.network.snapshot!, own = s.players.find(p => p.playerId === s.localPlayerId)!, other = s.players.find(p => p.playerId !== s.localPlayerId)!;
      const game = app.modes.shooter!, dx = other.x - own.x, dz = other.z - own.z;
      game.input.yaw = Math.atan2(-dx, -dz); game.input.pitch = Math.atan2(other.y + 1.14 - (own.y + own.height! - .1), Math.hypot(dx, dz));
    });
    await first.waitForTimeout(300);
    await first.mouse.down(); await first.mouse.up();
    await expect.poll(async () => (await targetState()).health).toBe(50);
    await expect.poll(() => second.evaluate(() => window.sdpUnified.modes.shooter!.health)).toBe(50);
    await expect.poll(() => second.locator('.damage-vignette').evaluate(node => Number(getComputedStyle(node).opacity))).toBeGreaterThan(0);
    await second.screenshot({ path: info.outputPath('white-digital-damage.png') });
    await first.evaluate(() => {
      const app = window.sdpUnified, s = app.network.snapshot!, own = s.players.find(p => p.playerId === s.localPlayerId)!, other = s.players.find(p => p.playerId !== s.localPlayerId)!;
      const game = app.modes.shooter!, dx = other.x - own.x, dz = other.z - own.z;
      game.input.yaw = Math.atan2(-dx, -dz); game.input.pitch = Math.atan2(other.y + 1.14 - (own.y + own.height! - .1), Math.hypot(dx, dz));
    });
    await first.waitForTimeout(250);
    await first.mouse.down(); await first.mouse.up();
    await expect.poll(async () => (await targetState()).dead).toBe(true);
    const dead = await targetState(); const steps = await second.evaluate(() => window.sdpUnified.modes.shooter!.fixedSteps);
    await expect(second.locator('.desynchronization-state')).toBeVisible(); await expect(first.locator('.kill-announcement')).toBeVisible();
    await expect(first.locator('.shooter-strike')).toContainText('STREAK 01');
    await expect(first.locator('.shooter-kill-feed .kill-player')).toHaveText(['SDP Tester', 'SDP Tester #2']);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.modes.shooter!.remotes.group.children[0].userData.coherence)).toBeLessThan(.95);
    await first.screenshot({ path: info.outputPath('avatar-desynchronizing.png') });
    await second.bringToFront(); await second.keyboard.down('KeyW'); await second.keyboard.press('KeyR'); await second.mouse.click(720, 500); await second.keyboard.up('KeyW');
    expect(await second.evaluate(() => window.sdpUnified.modes.shooter!.input.enabled)).toBe(false);
    expect(await second.evaluate(() => window.sdpUnified.modes.shooter!.fixedSteps)).toBe(steps);
    const stillDead = await targetState(); expect(stillDead.ammo).toBe(30); expect(stillDead.reloading).toBe(false);
    expect(Math.hypot(stillDead.x - dead.x, stillDead.z - dead.z)).toBeLessThan(.01);
    await expect.poll(async () => (await targetState()).life, { timeout: 7000 }).toBe(dead.life! + 1);
    const revived = await targetState();
    expect(revived.spawnY).toBeLessThan(1); expect(dead.spawnY).toBeLessThan(1);
    expect(revived.bornAt! - dead.diedAt!).toBeGreaterThanOrEqual(3000); expect(revived.bornAt! - dead.diedAt!).toBeLessThan(3250);
    expect(revived.health).toBe(100); expect(revived.ammo).toBe(30); expect(revived.dead).toBe(false);
    expect(revived.protectedUntil!).toBeGreaterThan(revived.bornAt!);
    expect(Math.hypot(revived.x - dead.x, revived.z - dead.z)).toBeGreaterThan(3);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.modes.shooter!.remotes.group.children[0].userData.life)).toBe(revived.life);
    expect(await first.evaluate(() => window.sdpUnified.modes.shooter!.remotes.group.children[0].userData.coherence)).toBeLessThan(1);
    await expect.poll(() => second.evaluate(() => window.sdpUnified.modes.shooter!.dead)).toBe(false);
    await expect(second.locator('.desynchronization-state')).toBeHidden();
    expect(await second.evaluate(() => Math.abs(window.sdpUnified.modes.shooter!.weapon.springs.recoil.velocity))).toBeLessThan(.001);
    await second.screenshot({ path: info.outputPath('server-respawn.png') });
    await first.bringToFront(); await first.keyboard.press('KeyP');
    await expect(first.getByRole('table', { name: 'Room scores' })).toBeVisible();
    await expect(first.locator('.session-ranking tbody tr')).toHaveCount(2);
    await expect(first.locator('.session-ranking tbody tr').first().locator('td')).toHaveText(['1', 'SDP Tester', '1', '0', '1']);
    await expect(first.locator('.session-ranking tbody tr').nth(1).locator('td')).toHaveText(['2', 'SDP Tester #2', '0', '1', '0']);
    await first.screenshot({ path: info.outputPath('ranked-live-session.png') });
    expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); }
});
test('two browsers: ground spawns, correctly aimed remote weapon and stable movement with 160ms RTT plus jitter', async ({ browser }, info) => {
  const a = await browser.newContext(), b = await browser.newContext(), first = await a.newPage(), second = await b.newPage();
  const errors: string[] = [];
  for (const page of [first, second]) page.on('pageerror', error => errors.push(error.message));
  await first.addInitScript(() => {
    // Delay real Colyseus WS delivery while preserving native protocol validation.
    window.WebSocket = new Proxy(window.WebSocket, { construct(target, args) {
      const socket = Reflect.construct(target, args) as WebSocket;
      if (!String(args[0]).includes('/multiplayer/')) return socket;
      const send = socket.send.bind(socket); let outgoing = 0, incoming = 0;
      socket.send = data => {
        const payload = data instanceof ArrayBuffer ? data.slice(0) : ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice() : data;
        outgoing = Math.max(outgoing, performance.now() + 80);
        setTimeout(() => { if (socket.readyState === WebSocket.OPEN) send(payload); }, outgoing - performance.now());
      };
      socket.addEventListener('message', event => {
        event.stopImmediatePropagation();
        const now = performance.now(), jitter = now % 1800 < 140 ? 140 : 0;
        incoming = Math.max(incoming, now + 80 + jitter);
        setTimeout(() => { if (socket.readyState === WebSocket.OPEN) socket.onmessage?.call(socket, event); }, incoming - now);
      });
      return socket;
    } });
  });
  try {
    await enterLimbo(first); await openProtocol(first); await enterShooter(first);
    await enterLimbo(second); await openProtocol(second); await enterShooter(second);
    await first.bringToFront(); if (await first.getByRole('button', { name: 'RESUME', exact: true }).isVisible()) await first.getByRole('button', { name: 'RESUME', exact: true }).click();
    expect(await first.evaluate(() => window.sdpUnified.modes.shooter!.player!.spawn.y)).toBeLessThan(1);
    await first.evaluate(() => { const input = window.sdpUnified.modes.shooter!.input; input.yaw = .7; input.pitch = .35; });
    await expect.poll(() => second.evaluate(() => {
      const game = window.sdpUnified.modes.shooter!, remote = game.remotes.group.children[0];
      if (!remote) return 0;
      remote.updateMatrixWorld(true);
      const model = remote.getObjectByName('remote-weapon-model')!, mount = remote.getObjectByName('remote-weapon-mount')!;
      const forward = game.camera.aimDirection.clone().set(0, 0, 1).transformDirection(model.matrixWorld);
      const expected = game.camera.aimDirection.clone().set(0, 0, -1).transformDirection(mount.matrixWorld);
      return forward.dot(expected);
    })).toBeGreaterThan(.999);
    await second.evaluate(() => {
      const app = window.sdpUnified, game = app.modes.shooter!, state = app.network.snapshot!;
      const own = state.players.find(p => p.playerId === state.localPlayerId)!, other = state.players.find(p => p.playerId !== state.localPlayerId)!;
      game.input.yaw = Math.atan2(-(other.x - own.x), -(other.z - own.z));
      game.input.pitch = Math.atan2(other.y + 1.15 - (own.y + 1.7), Math.hypot(other.x - own.x, other.z - own.z));
    });
    await second.waitForTimeout(150);
    await second.screenshot({ path: info.outputPath('ground-spawn-remote-weapon.png') });
    expect(await first.evaluate(() => window.sdpUnified.network.ping())).toBeGreaterThanOrEqual(150);
    await first.evaluate(() => {
      const game = window.sdpUnified.modes.shooter!; game.input.yaw = 0; game.input.pitch = 0;
      game.input.yaw = Math.PI;
      window.shooterMotionSamples = [];
      const start = performance.now();
      const sample = (now: number) => {
        const p = game.camera.root.position;
        window.shooterMotionSamples.push({ time: now, x: p.x, y: p.y, z: p.z });
        if (now - start < 5000) requestAnimationFrame(sample);
      }; requestAnimationFrame(sample);
    });
    const remoteBefore = await second.evaluate(() => window.sdpUnified.modes.shooter!.remotes.group.children[0].position.toArray());
    await first.keyboard.down('ShiftLeft'); await first.keyboard.down('KeyW'); await first.waitForTimeout(3000);
    await first.keyboard.up('KeyW'); await first.keyboard.up('ShiftLeft'); await first.waitForTimeout(2200);
    const data = await first.evaluate(() => {
      const app = window.sdpUnified, game = app.modes.shooter!, snapshot = app.network.snapshot!, local = snapshot.players.find(p => p.playerId === snapshot.localPlayerId)!;
      return { samples: window.shooterMotionSamples, network: game.snapshot.network, status: app.network.status.state,
        finalPositionError: Math.hypot(game.player!.current.x - local.x, game.player!.current.z - local.z) };
    });
    const excess = data.samples.slice(1).map((sample, index) => {
      const before = data.samples[index], dt = (sample.time - before.time) / 1000;
      return Math.hypot(sample.x - before.x, sample.z - before.z) - 6.6 * Math.min(dt, .125);
    });
    expect(data.samples.length).toBeGreaterThan(30); expect(data.status).toBe('connected');
    expect(data.finalPositionError).toBeLessThan(.8);
    expect(data.network.teleports).toBe(0); expect(Math.max(...excess)).toBeLessThan(.4);
    expect(data.network.maxSnapshotGapMs).toBeGreaterThan(90);
    expect(data.network.interpolationMs).toBeGreaterThan(70);
    const moved = await second.evaluate(before => {
      const p = window.sdpUnified.modes.shooter!.remotes.group.children[0].position;
      return Math.hypot(p.x - before[0], p.z - before[2]);
    }, remoteBefore);
    expect(moved).toBeGreaterThan(1);
    await info.attach('simulated-network-results', { body: JSON.stringify({ ...data, samples: data.samples.length,
      maximumCameraDiscontinuity: Math.max(...excess), remoteMovement: moved }, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); }
});
test('Limbo sprint is immediate, smooth and visible in authoritative movement', async ({ page }) => {
  await enterLimbo(page);
  const z0 = await page.evaluate(() => window.sdpUnified.player.camera.position.z);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(800); await page.keyboard.up('KeyW');
  const z1 = await page.evaluate(() => window.sdpUnified.player.camera.position.z);
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await page.waitForTimeout(800); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
  const z2 = await page.evaluate(() => window.sdpUnified.player.camera.position.z);
  expect(z1 - z2).toBeGreaterThan((z0 - z1) * 1.25);
  // Input and room patches run at 20 Hz; compare fresh positions after key release.
  await expect.poll(() => page.evaluate(() => {
    const app = window.sdpUnified, snapshot = app.network.snapshot!;
    const server = snapshot.players.find(player => player.playerId === snapshot.localPlayerId)!;
    return Math.abs(server.z - app.player.camera.position.z);
  }), { timeout: 2500 }).toBeLessThan(.5);
});
test('actual requests stay lazy; both scenes render; controls and repeated return work', async ({ page }, info) => {
  const requests: string[] = [], errors: string[] = [];
  page.on('request', request => requests.push(request.url())); page.on('pageerror', error => errors.push(error.message));
  await enterLimbo(page); await page.screenshot({ path: info.outputPath('limbo-desktop.png') });
  const baselineMemory = await page.evaluate(() => ({ ...window.sdpUnified.scene.renderer.info.memory }));
  expect(await visiblePixels(page)).toBeGreaterThan(300);
  expect(requests.filter(shooterRequest)).toEqual([]);
  await openProtocol(page); await page.waitForTimeout(1000);
  await page.screenshot({ path: info.outputPath('protocol-menu.png') });
  expect(requests.filter(shooterRequest)).toEqual([]);
  await enterShooter(page);
  expect(requests.some(url => url.includes('dust2plainmap.glb'))).toBe(true);
  await expect(page.locator('canvas.scene-canvas')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter?.player?.grounded)).toBe(true);
  expect(await visiblePixels(page)).toBeGreaterThan(10000);
  await page.screenshot({ path: info.outputPath('shooter-desktop.png') });
  const start = await page.evaluate(() => window.sdpUnified.modes.shooter!.player!.current.toArray());
  await page.keyboard.down('KeyW'); await page.waitForTimeout(700); await page.keyboard.up('KeyW');
  const moved = await page.evaluate(() => window.sdpUnified.modes.shooter!.player!.current.toArray());
  expect(Math.hypot(start[0] - moved[0], start[2] - moved[2])).toBeGreaterThan(.4);
  await page.keyboard.down('ControlLeft');
  await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter!.player!.height)).toBeLessThan(1.3);
  await page.keyboard.up('ControlLeft');
  await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter!.player!.height)).toBeGreaterThan(1.7);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter!.player!.grounded)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter!.player!.grounded)).toBe(true);
  await page.mouse.click(720, 500);
  await expect.poll(() => page.evaluate(() => window.sdpUnified.modes.shooter!.shooting!.shotsFired)).toBeGreaterThan(0);
  await expect(page.locator('.shooter-magazine')).toHaveText('29');
  await page.keyboard.press('KeyR'); await expect(page.locator('.shooter-action')).toHaveText('RELOADING');
  await expect(page.locator('.shooter-magazine')).toHaveText('30');
  await page.keyboard.press('Enter'); await page.getByRole('textbox', { name: 'Chat message' }).fill('Shooter room only'); await page.keyboard.press('Enter');
  await expect(page.locator('.chat-message')).toContainText('Shooter room only');
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'RESUME', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.sdpUnified.modes.value)).toBe('SHOOTER');
  await page.evaluate(() => window.retiredShooter = window.sdpUnified.modes.shooter);
  await page.getByRole('button', { name: 'RETURN TO LIMBO' }).click();
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'LIMBO');
  await expect(page.locator('.chat-message')).toHaveCount(0);
  await expect(page.locator('canvas.scene-canvas')).toHaveCount(1);
  const steps = await page.evaluate(() => window.retiredShooter!.fixedSteps);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.retiredShooter!.fixedSteps)).toBe(steps);
  expect(await page.evaluate(() => window.retiredShooter!.scene.children.length)).toBe(0);
  const firstReturnMemory = await page.evaluate(() => ({ ...window.sdpUnified.scene.renderer.info.memory }));
  expect(firstReturnMemory.geometries).toBeLessThanOrEqual(baselineMemory.geometries + 4);
  expect(firstReturnMemory.textures).toBeLessThanOrEqual(baselineMemory.textures + 4);
  await page.getByRole('button', { name: 'CLICK TO RESUME' }).click();
  await openProtocol(page); await enterShooter(page);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'RETURN TO LIMBO' }).click();
  await expect(page.locator('#app')).toHaveAttribute('data-mode', 'LIMBO');
  await page.waitForTimeout(300);
  const secondReturnMemory = await page.evaluate(() => ({ ...window.sdpUnified.scene.renderer.info.memory }));
  expect(secondReturnMemory.geometries).toBeLessThanOrEqual(firstReturnMemory.geometries + 1);
  expect(secondReturnMemory.textures).toBeLessThanOrEqual(firstReturnMemory.textures + 1);
  expect(requests.filter(url => url.includes('dust2plainmap.glb'))).toHaveLength(1);
  await page.screenshot({ path: info.outputPath('returned-limbo.png') });
  expect(errors).toEqual([]);
});
test('two browsers synchronize in Shooter and stay isolated from Limbo voice and chat', async ({ browser }, info) => {
  const a = await browser.newContext(), b = await browser.newContext(), c = await browser.newContext();
  const first = await a.newPage(), second = await b.newPage(), limbo = await c.newPage();
  const errors: string[] = []; for (const page of [first, second, limbo]) page.on('pageerror', error => errors.push(error.message));
  try {
    await enterLimbo(first); await enterLimbo(second); await enterLimbo(limbo);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.network.status.online)).toBe(3);
    await first.bringToFront(); if (await first.locator('.resume-button').isVisible()) await first.locator('.resume-button').click();
    await openProtocol(first); await enterShooter(first);
    expect(await first.evaluate(() => window.sdpUnified.voiceTransport.state)).toBe('disconnected');
    await second.bringToFront(); if (await second.locator('.resume-button').isVisible()) await second.locator('.resume-button').click();
    await openProtocol(second); await enterShooter(second);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.network.status.online)).toBe(2);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.modes.shooter!.remotes.count)).toBe(1);
    for (const page of [first, second]) {
      expect(await page.evaluate(() => {
        const app = window.sdpUnified, state = app.network.snapshot!;
        const local = state.players.find(player => player.playerId === state.localPlayerId)!;
        const spawn = app.modes.shooter!.player!.spawn;
        return Math.hypot(spawn.x - local.spawnX!, spawn.y - local.spawnY!, spawn.z - local.spawnZ!);
      })).toBeLessThan(.01);
    }
    await expect.poll(() => limbo.evaluate(() => window.sdpUnified.network.status.online)).toBe(1);
    const rooms = await Promise.all([first.evaluate(() => window.sdpUnified.network.status.roomId), second.evaluate(() => window.sdpUnified.network.status.roomId), limbo.evaluate(() => window.sdpUnified.network.status.roomId)]);
    expect(rooms[0]).toBe(rooms[1]); expect(rooms[0]).not.toBe(rooms[2]);
    await first.bringToFront(); if (await first.getByRole('button', { name: 'RESUME', exact: true }).isVisible()) await first.getByRole('button', { name: 'RESUME', exact: true }).click();
    const position = await second.evaluate(() => window.sdpUnified.modes.shooter!.remotes.group.children[0].position.toArray());
    await first.keyboard.down('KeyW'); await first.waitForTimeout(1000); await first.keyboard.up('KeyW');
    await expect.poll(() => second.evaluate(before => { const p = window.sdpUnified.modes.shooter!.remotes.group.children[0].position; return Math.hypot(p.x - before[0], p.z - before[2]); }, position)).toBeGreaterThan(.5);
    await first.mouse.click(720, 500); await expect.poll(() => second.evaluate(() => window.sdpUnified.network.snapshot!.players.some(p => p.playerId !== window.sdpUnified.network.snapshot!.localPlayerId && p.ammo === 29))).toBe(true);
    await first.keyboard.press('Enter'); await first.getByRole('textbox', { name: 'Chat message' }).fill('Only combat room'); await first.keyboard.press('Enter');
    await expect(second.locator('.chat-message')).toContainText('Only combat room'); await expect(limbo.locator('.chat-message')).toHaveCount(0);
    await second.evaluate(() => {
      const game = window.sdpUnified.modes.shooter!, remote = game.remotes.group.children[0].position, own = game.player!.current;
      game.input.yaw = Math.atan2(-(remote.x - own.x), -(remote.z - own.z));
      game.input.pitch = Math.atan2(remote.y + 1.2 - (own.y - game.player!.height / 2 + 1.7), Math.hypot(remote.x - own.x, remote.z - own.z));
      window.sdpUnified.modes.ui.hide(); game.remotes.group.children[0].visible = false;
    });
    await second.waitForTimeout(300);
    const withoutAvatar = await sharp(await second.locator('canvas.scene-canvas').screenshot()).removeAlpha().raw().toBuffer();
    await second.evaluate(() => window.sdpUnified.modes.shooter!.remotes.group.children[0].visible = true);
    const withAvatar = await sharp(await second.locator('canvas.scene-canvas').screenshot()).removeAlpha().raw().toBuffer();
    let avatarPixels = 0;
    for (let i = 0; i < withoutAvatar.length; i += 3) if (Math.abs(withoutAvatar[i] - withAvatar[i]) + Math.abs(withoutAvatar[i + 1] - withAvatar[i + 1]) + Math.abs(withoutAvatar[i + 2] - withAvatar[i + 2]) > 12) avatarPixels++;
    expect(avatarPixels).toBeGreaterThan(250);
    await second.screenshot({ path: info.outputPath('two-shooter-players.png') });
    await first.close(); await expect.poll(() => second.evaluate(() => window.sdpUnified.modes.shooter!.remotes.count)).toBe(0);
    expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); await c.close(); }
});
test('failed assets allow retry and returning; mobile Limbo remains framed', async ({ page, browser }, info) => {
  await page.route('**/shooter/MAP/dust2plainmap.glb', route => route.abort());
  await enterLimbo(page); await openProtocol(page); await page.getByRole('button', { name: 'JOIN SHOOTER', exact: true }).click();
  await expect(page.getByRole('button', { name: 'RETRY', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'RETURN TO LIMBO' }).click(); await expect(page.locator('#app')).toHaveAttribute('data-mode', 'LIMBO');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const mobile = await context.newPage(); await mobile.goto('/'); await enterExhibition(mobile);
    await expect(mobile.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
    await walkToSculpture(mobile);
    await expect(mobile.locator('.ui')).toHaveAttribute('data-state', 'INSPECTING'); expect(await visiblePixels(mobile)).toBeGreaterThan(1000);
    const button = await mobile.getByRole('button', { name: 'JOIN SHOOTER', exact: true }).boundingBox();
    expect(button!.y + button!.height).toBeLessThanOrEqual(844);
    await expect(mobile.locator('.touch-stick')).toBeHidden();
    await mobile.screenshot({ path: info.outputPath('limbo-mobile-inspection.png') });
    await mobile.getByRole('button', { name: 'Close inspection' }).click(); await expect(mobile.locator('canvas.scene-canvas')).toHaveCount(1);
  } finally { await context.close(); }
});
test('Limbo text and real WebRTC media work; voice disconnects in Shooter and returns using one audio context', async ({ browser, request }) => {
  const health = await (await request.get('/multiplayer/health')).json() as { voice: string };
  test.skip(health.voice !== 'configured', 'Requires a real local or configured LiveKit service.');
  const a = await browser.newContext(), b = await browser.newContext();
  try {
    const first = await a.newPage(), second = await b.newPage();
    await first.addInitScript(() => {
      window.audioContexts = 0;
      window.createdAudioContexts = [];
      const original = window.AudioContext;
      window.AudioContext = new Proxy(original, { construct(target, args) {
        window.audioContexts++; const context = Reflect.construct(target, args) as AudioContext;
        window.createdAudioContexts.push(context); return context;
      } });
    });
    await enterLimbo(first); await enterLimbo(second);
    await expect.poll(() => first.evaluate(() => window.sdpUnified.voiceTransport.state)).toBe('connected');
    await expect.poll(() => second.evaluate(() => window.sdpUnified.voiceTransport.state)).toBe('connected');
    await first.bringToFront(); if (await first.locator('.resume-button').isVisible()) await first.locator('.resume-button').click();
    await first.keyboard.press('Enter'); await first.getByRole('textbox', { name: 'Chat message' }).fill('Shared Limbo'); await first.keyboard.press('Enter');
    await expect(second.locator('.chat-message')).toContainText('Shared Limbo');
    await expect(first.locator('.ui')).toHaveAttribute('data-state', 'EXPLORING');
    await first.waitForFunction(() => !!document.pointerLockElement && document.hasFocus());
    await first.keyboard.down('KeyV');
    await expect.poll(() => first.evaluate(() => window.sdpUnified.voiceTransport.transmitting)).toBe(true);
    await expect.poll(() => second.evaluate(async () => {
      const data = await window.sdpUnified.voiceTransport.diagnostics();
      return data.remote.reduce((total, remote) => total + (remote.stats?.bytesReceived || 0), 0);
    })).toBeGreaterThan(100);
    await expect.poll(() => second.evaluate(() => Math.max(0, ...window.sdpUnified.voiceTransport.voiceLevels.values()))).toBeGreaterThan(.05);
    await expect.poll(() => second.evaluate(() => {
      const visitors = window.sdpUnified.scene.remotePlayers.group.children;
      return Math.max(0, ...visitors.map(visitor => ((visitor.children[0] as Mesh).material as MeshStandardMaterial).opacity));
    })).toBeGreaterThan(.70);
    await first.keyboard.up('KeyV'); await expect.poll(() => first.evaluate(() => window.sdpUnified.voiceTransport.transmitting)).toBe(false);
    await expect.poll(() => second.evaluate(() => Math.max(0, ...window.sdpUnified.voiceTransport.voiceLevels.values()))).toBe(0);
    await expect.poll(() => second.evaluate(() => {
      const visitors = window.sdpUnified.scene.remotePlayers.group.children;
      return Math.max(0, ...visitors.map(visitor => ((visitor.children[0] as Mesh).material as MeshStandardMaterial).opacity));
    })).toBeLessThan(.685);
    await openProtocol(first); await enterShooter(first);
    expect(await first.evaluate(() => window.sdpUnified.voiceTransport.state)).toBe('disconnected');
    await expect.poll(() => first.evaluate(() => window.createdAudioContexts.filter(context => context.state !== 'closed').length)).toBe(1);
    await first.keyboard.press('Escape'); await first.getByRole('button', { name: 'RETURN TO LIMBO' }).click();
    await expect.poll(() => first.evaluate(() => window.sdpUnified.voiceTransport.state)).toBe('connected');
    await expect.poll(() => first.evaluate(() => window.createdAudioContexts.filter(context => context.state !== 'closed').length)).toBe(1);
  } finally { await a.close(); await b.close(); }
});

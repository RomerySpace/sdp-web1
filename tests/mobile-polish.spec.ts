import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { enterExhibition } from './entry';
import { touchDriver, walkToSculpture } from './touch-driver';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
async function fullscreenFixture(page: Page): Promise<void> {
  await page.route('**/__fullscreen-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main class="protocol-content"></main>' }));
  await page.goto('/__fullscreen-fixture');
  await page.evaluate(async () => {
    await import(/* @vite-ignore */ '/src/styles/' + 'modes.css');
    const { SettingsPanel } = await import(/* @vite-ignore */ '/src/ui/' + 'SettingsPanel.ts');
    const { PlayerSettings } = await import(/* @vite-ignore */ '/src/core/' + 'PlayerSettings.ts');
    document.querySelector('main')!.append(new SettingsPanel(new PlayerSettings(), 'fixture').element);
  });
}
test('mobile fullscreen uses a real tap and updates its enter/exit state', async ({ page }) => {
  await fullscreenFixture(page);
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(page.getByRole('button', { name: 'Exit fullscreen', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
});
test('mobile WebKit adapter supports void-returning prefixed APIs and change events', async ({ page }) => {
  await page.addInitScript(() => {
    let active = false;
    Object.defineProperty(document, 'fullscreenEnabled', { value: false });
    Object.defineProperty(document, 'webkitFullscreenEnabled', { value: true });
    Object.defineProperty(document, 'webkitFullscreenElement', { get: () => active ? document.documentElement : null });
    Object.defineProperty(HTMLElement.prototype, 'webkitRequestFullscreen', { value() { active = true; document.dispatchEvent(new Event('webkitfullscreenchange')); }, configurable: true });
    Object.defineProperty(document, 'webkitExitFullscreen', { value() { active = false; document.dispatchEvent(new Event('webkitfullscreenchange')); } });
  });
  await fullscreenFixture(page);
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Exit fullscreen', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Enter fullscreen', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.settings-status')).toBeHidden();
});
test('unsupported mobile fullscreen responds instead of silently disabling, with real Home Screen metadata', async ({ page, request }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: false });
    Object.defineProperty(document, 'webkitFullscreenEnabled', { value: false });
  });
  await fullscreenFixture(page);
  const button = page.getByRole('button', { name: 'Enter fullscreen', exact: true });
  await expect(button).toBeEnabled();await button.tap();
  await expect(page.locator('.settings-status')).toContainText('Home Screen');
  const response = await request.get('/manifest.webmanifest');expect(response.ok()).toBe(true);
  const manifest = await response.json();expect(manifest).toMatchObject({ name: 'SDP', display: 'fullscreen', start_url: '/' });
  for(const icon of manifest.icons as {src:string;sizes:string}[]) {
    const image = await request.get(icon.src);expect(image.ok()).toBe(true);
    const metadata = await sharp(await image.body()).metadata();expect(`${metadata.width}x${metadata.height}`).toBe(icon.sizes);
  }
  const html = await (await request.get('/')).text();expect(html).toContain('apple-mobile-web-app-capable');expect(html).toContain('/manifest.webmanifest');
});
test('a rejected native fullscreen promise provides feedback and Home Screen mode is recognized', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { value: () => Promise.reject(new Error('Permission denied')), configurable: true }));
  await fullscreenFixture(page);await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).tap();
  await expect(page.locator('.settings-status')).toContainText('Fullscreen is unavailable');
  await page.evaluate(() => { Object.defineProperty(navigator, 'standalone', { value: true }); document.dispatchEvent(new Event('fullscreenchange')); });
  await expect(page.getByRole('button', { name: 'Fullscreen app', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Fullscreen app', exact: true }).tap();
  await expect(page.locator('.settings-status')).toContainText('already open');
});

type Probe = { context: AudioContext; analyser: AnalyserNode; peak: number; frame: number };
declare global { interface Window { sfxProbe?: Probe } }
async function resetProbe(page:Page):Promise<void> { await page.evaluate(() => { window.sfxProbe!.peak=0; }); }
async function audible(page:Page):Promise<void> { await expect.poll(() => page.evaluate(() => window.sfxProbe!.peak)).toBeGreaterThan(.0001); }
async function holdFire(page:Page):Promise<void> {
  const rect=(await page.getByRole('button',{name:'Fire weapon',exact:true}).boundingBox())!,driver=await touchDriver(page);
  await driver.down(1,rect.x+rect.width/2,rect.y+rect.height/2);await page.waitForTimeout(160);await driver.up(1);
}
async function touchVolume(page:Page, maximum:boolean, name='Game volume'):Promise<void> {
  const slider=page.getByRole('slider',{name,exact:true}),rect=(await slider.boundingBox())!;
  await page.touchscreen.tap(maximum?rect.x+rect.width-1:rect.x+1,rect.y+rect.height/2);
  await expect(slider).toHaveValue(maximum?'1':'0');
}
test('actual mobile menus fullscreen in both worlds; real shot, reload, footsteps and strike audio survive interruption', async ({ page },info) => {
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('sdp:musicVolume','0');localStorage.setItem('sdp:volume','1');localStorage.setItem('sdp:muted','false');
    const Original=window.AudioContext;window.audioContexts=0;
    window.AudioContext=class extends Original { constructor(...args:ConstructorParameters<typeof AudioContext>){super(...args);window.audioContexts++;} };
  });
  await page.goto('/?debugMode=limbo');await enterExhibition(page,'Mobile Polish');
  await page.getByRole('button',{name:'Open game menu',exact:true}).tap();
  await page.getByRole('button',{name:'Enter fullscreen',exact:true}).tap();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
  await page.getByRole('button',{name:'Exit fullscreen',exact:true}).tap();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
  await page.getByRole('button',{name:'RETURN P',exact:true}).tap();await walkToSculpture(page);
  await page.getByRole('button',{name:'JOIN SHOOTER',exact:true}).tap();await expect(page.locator('#app')).toHaveAttribute('data-mode','SHOOTER',{timeout:90000});
  await page.getByRole('button',{name:'ENTER SIMULATION',exact:true}).tap();
  await page.evaluate(()=>{
    const audio=window.sdpUnified.modes.shooter!.audio as unknown as {context:AudioContext;gain:GainNode};
    const analyser=audio.context.createAnalyser();analyser.fftSize=2048;audio.gain.connect(analyser);
    const probe=window.sfxProbe={context:audio.context,analyser,peak:0,frame:0};
    const sample=()=>{const buffer=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(buffer);for(const value of buffer)probe.peak=Math.max(probe.peak,Math.abs(value));probe.frame=requestAnimationFrame(sample);};sample();
  });
  await resetProbe(page);await holdFire(page);await audible(page);await expect(page.locator('.shooter-magazine')).toHaveText('29');
  await page.waitForTimeout(250);await resetProbe(page);await page.getByRole('button',{name:'Reload weapon',exact:true}).tap();await audible(page);
  await expect.poll(()=>page.evaluate(()=>window.sdpUnified.modes.shooter!.weapon.reloading)).toBe(false);
  await page.waitForTimeout(200);await resetProbe(page);
  const driver=await touchDriver(page),pad=(await page.locator('.touch-stick').boundingBox())!,x=pad.x+pad.width/2,y=pad.y+pad.height/2;
  await driver.down(1,x,y);await driver.move(1,x,y-pad.width*.35);
  try {await audible(page);}finally{await driver.up(1);}
  for(const phase of ['flyover','impact'] as const){
    await page.waitForTimeout(1700);await resetProbe(page);
    await page.evaluate(phase=>{const s=window.sdpUnified.modes.shooter!;s.audio.airstrike(phase,s.camera.camera.getWorldPosition(s.camera.aimDirection.clone()),s.camera.camera);},phase);
    await audible(page);
  }
  await page.waitForTimeout(1700);await resetProbe(page);await page.evaluate(()=>window.sfxProbe!.context.suspend());
  await holdFire(page);await expect.poll(()=>page.evaluate(()=>window.sfxProbe!.context.state)).toBe('running');await audible(page);
  expect(await page.evaluate(()=>window.audioContexts)).toBe(1);
  await page.getByRole('button',{name:'Open game menu',exact:true}).tap();
  await page.getByRole('button',{name:'Enter fullscreen',exact:true}).tap();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
  await page.getByRole('button',{name:'Exit fullscreen',exact:true}).tap();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
  await page.getByRole('button',{name:'Mute audio',exact:true}).tap();await page.getByRole('button',{name:'RESUME',exact:true}).tap();
  await page.waitForTimeout(350);await resetProbe(page);await holdFire(page);await page.waitForTimeout(200);expect(await page.evaluate(()=>window.sfxProbe!.peak)).toBeLessThan(.00001);
  await page.getByRole('button',{name:'Open game menu',exact:true}).tap();await page.getByRole('button',{name:'Unmute audio',exact:true}).tap();
  await touchVolume(page,false);await page.getByRole('button',{name:'RESUME',exact:true}).tap();
  await page.waitForTimeout(350);
  expect(await page.evaluate(()=>window.sdpUnified.modes.shooter!.audio.volume)).toBe(0);
  await resetProbe(page);await holdFire(page);expect(await page.evaluate(()=>window.sfxProbe!.peak)).toBeLessThan(.00001);
  await page.getByRole('button',{name:'Open game menu',exact:true}).tap();await touchVolume(page,true);await page.getByRole('button',{name:'RESUME',exact:true}).tap();
  await page.waitForTimeout(350);await resetProbe(page);await holdFire(page);await audible(page);
  await page.screenshot({path:info.outputPath('mobile-shooter-audio-fullscreen.png')});
  await page.evaluate(()=>{
    const s=window.sdpUnified.modes.shooter!,context=window.sfxProbe!.context;
    s.audio.setVisible(false);s.audio.shot();s.audio.reload();s.audio.step(false);
    if(context.state!=='running')throw new Error('Shooter suspended the shared music/voice context');s.audio.setVisible(true);
    window.retiredShooter=s;cancelAnimationFrame(window.sfxProbe!.frame);window.sfxProbe!.analyser.disconnect();
  });
  await page.getByRole('button',{name:'Open game menu',exact:true}).tap();await page.getByRole('button',{name:'RETURN TO LIMBO',exact:true}).tap();
  await expect(page.locator('#app')).toHaveAttribute('data-mode','LIMBO');
  expect(await page.evaluate(()=>{const audio=window.retiredShooter!.audio as unknown as {strikeSources:Set<AudioScheduledSourceNode>};return audio.strikeSources.size;})).toBe(0);
  expect(errors).toEqual([]);
});
test('mobile music mixer really silences and restores a supplied stream without adding public music', async ({ page }) => {
  const rate=8000,seconds=60,wav=Buffer.alloc(44+rate*seconds);
  wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate,28);wav.writeUInt16LE(1,32);wav.writeUInt16LE(8,34);wav.write('data',36);wav.writeUInt32LE(rate*seconds,40);
  for(let i=44;i<wav.length;i++)wav[i]=128+Math.round(16*Math.sin(i*.2));
  await page.route('**/audio/playlist.json',route=>route.fulfill({json:[{id:'music-fixture',title:'Test stream',artist:'Test fixture',url:'/audio/music-fixture.wav',duration:seconds}]}));
  await page.route('**/audio/music-fixture.wav',route=>route.fulfill({contentType:'audio/wav',body:wav}));
  await page.addInitScript(()=>{
    const connect=AudioNode.prototype.connect as (this:AudioNode,node:AudioNode|AudioParam,output?:number,input?:number)=>AudioNode|void;
    AudioNode.prototype.connect=function(this:AudioNode,node:AudioNode|AudioParam,output:number=0,input:number=0){
      if(this instanceof MediaElementAudioSourceNode&&node instanceof GainNode){
        const analyser=this.context.createAnalyser();connect.call(node,analyser);
        Object.assign(window,{musicMeter:analyser});
      }
      if(node instanceof AudioNode)return connect.call(this,node,output,input);
      connect.call(this,node,output);
    } as typeof AudioNode.prototype.connect;
  });
  const level=()=>page.evaluate(()=>{
    const analyser=(window as Window&{musicMeter?:AnalyserNode}).musicMeter;if(!analyser)return 0;
    const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs));
  });
  await page.goto('/?debugMode=limbo');await enterExhibition(page,'Music Volume Test');await expect.poll(level).toBeGreaterThan(.0001);
  const title = (await page.locator('.now-playing').boundingBox())!, tools = (await page.locator('.touch-tools').boundingBox())!;
  expect(title.y).toBeGreaterThan(tools.y + tools.height);
  expect(title.x + title.width).toBeCloseTo(390 - 18, 0);
  expect(title.y + title.height).toBeCloseTo(844 - 18, 0);
  await page.getByRole('button',{name:'Open game menu',exact:true}).tap();
  await touchVolume(page,false,'Music volume');await expect.poll(level).toBeLessThan(.00001);
  await touchVolume(page,true,'Music volume');await expect.poll(level).toBeGreaterThan(.0001);
  await page.getByRole('button',{name:'Mute audio',exact:true}).tap();await expect.poll(level).toBeLessThan(.00001);
  await page.getByRole('button',{name:'Unmute audio',exact:true}).tap();await expect.poll(level).toBeGreaterThan(.0001);
});

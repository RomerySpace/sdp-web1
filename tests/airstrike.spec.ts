import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { createServer as netServer } from 'node:net';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { airstrikeFixture, earnThree, inspectRoom } from '../server/tests/airstrike-fixture';
import { touchDriver } from './touch-driver';
import type { AirstrikeFlight } from '../shared/AirstrikeProtocol';
let fixture: Awaited<ReturnType<typeof airstrikeFixture>>, vite:ViteDevServer, url:string;
async function freePort():Promise<number>{const server=netServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port;}
test.beforeAll(async()=>{
  fixture=await airstrikeFixture();const port=await freePort();
  Object.assign(process.env,{SDP_BACKEND_PORT:String(fixture.port),SDP_WEB_PORT:String(port),VITE_SDP_SERVER_URL:'/multiplayer'});
  vite=await createServer({root:resolve(process.cwd()),mode:'unified',server:{host:'127.0.0.1',port,strictPort:true}});await vite.listen();url=`http://127.0.0.1:${port}`;
});
test.afterAll(async()=>{await vite?.close();await fixture?.server.gracefullyShutdown(false);});
test('two browsers: earned map, target marker, flight/missile/white blast, server damage, animation and cancellation',async({browser},info)=>{
  const a=await browser.newContext(),b=await browser.newContext(),first=await a.newPage(),second=await b.newPage(),errors:string[]=[];
  try{
    for(const page of [first,second]){page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGLProgram|shader|GL_INVALID/.test(m.text()))errors.push(m.text());});await page.goto(`${url}/?debugMode=shooter`);await expect(page.locator('#app')).toHaveAttribute('data-mode','SHOOTER',{timeout:90000});await page.getByRole('button',{name:'ENTER SIMULATION'}).click();}
    await first.bringToFront();if(await first.getByRole('button',{name:'RESUME',exact:true}).isVisible())await first.getByRole('button',{name:'RESUME',exact:true}).click();
    const roomId=await first.evaluate(()=>window.sdpUnified.network.snapshot!.roomId),owner=await first.evaluate(()=>window.sdpUnified.network.snapshot!.localPlayerId),victim=await second.evaluate(()=>window.sdpUnified.network.snapshot!.localPlayerId);
    const local=fixture.room(roomId);local.state.lighting='day';expect(await second.evaluate(()=>window.sdpUnified.network.snapshot!.roomId)).toBe(roomId);
    await first.evaluate(()=>{const audio=window.sdpUnified.modes.shooter!.audio as unknown as {context:AudioContext;gain:GainNode},meter=audio.context.createAnalyser();audio.gain.connect(meter);(window as Window&{strikeMeter?:AnalyserNode}).strikeMeter=meter;});
    await first.keyboard.press('Digit1');await expect(first.getByRole('dialog',{name:'Airstrike targeting map'})).toBeHidden();
    earnThree(local,owner,victim);await expect(first.getByRole('button',{name:'Deploy airstrike 1',exact:true})).toBeEnabled();
    await first.keyboard.press('Digit1');await expect(first.locator('.airstrike-map')).toHaveAttribute('data-phase','open');expect(await first.evaluate(()=>document.pointerLockElement)).toBeNull();
    expect(await first.evaluate(()=>window.sdpUnified.modes.shooter!.input.enabled)).toBe(false);
    const targetPlayer=local.state.players.get(victim)!,target=inspectRoom(local).world.strikeTarget(targetPlayer.x,targetPlayer.z)!;
    const coordinates=await first.evaluate(({x,z})=>{const m=window.sdpUnified.modes.shooter!.targeting.bounds;return{u:.5+(x-m.centerX)/m.span,v:.5+(z-m.centerZ)/m.span};},target);
    const bounds=(await first.locator('.strike-map-terrain').boundingBox())!;await first.mouse.click(bounds.x+coordinates.u*bounds.width,bounds.y+coordinates.v*bounds.height);
    await expect(first.locator('.strike-map-marker')).toBeVisible();await expect(first.getByRole('button',{name:'DEPLOY AIRSTRIKE',exact:true})).toBeEnabled();
    await first.screenshot({path:info.outputPath('tactical-map-desktop.png')});
    const image=await sharp(await first.locator('.strike-map-terrain').screenshot()).removeAlpha().raw().toBuffer();expect(new Set(image).size).toBeGreaterThan(50);
    const ammo=local.state.players.get(owner)!.ammo;await first.mouse.click(bounds.x+5,bounds.y+5);expect(local.state.players.get(owner)!.ammo).toBe(ammo);
    // Restore the valid marker after the deliberately invalid margin click.
    await first.mouse.click(bounds.x+coordinates.u*bounds.width,bounds.y+coordinates.v*bounds.height);
    await first.getByRole('button',{name:'DEPLOY AIRSTRIKE',exact:true}).click();
    await expect.poll(()=>local.state.airstrikes.length).toBe(1);await expect(first.locator('.airstrike-map')).toBeHidden();
    const strike=local.state.airstrikes[0];local.state.players.get(owner)!.protectedUntil=strike.impactAt+1000;
    await expect.poll(()=>second.evaluate(()=>window.sdpUnified.network.snapshot!.airstrikes?.length)).toBe(1);
    local.clock.elapsedTime=strike.releasedAt+200;
    await expect.poll(()=>first.evaluate(()=>{const root=window.sdpUnified.modes.shooter!.airstrikes.root;return root.children.some(group=>group.visible&&group.children[1].visible);})).toBe(true);
    const before=await first.evaluate(()=>window.sdpUnified.modes.shooter!.airstrikes.root.children.find(group=>group.visible)!.children[0].position.toArray());
    await first.waitForTimeout(200);
    expect(await first.evaluate(p=>{const jet=window.sdpUnified.modes.shooter!.airstrikes.root.children.find(group=>group.visible)!.children[0];return Math.hypot(jet.position.x-p[0],jet.position.z-p[2]);},before)).toBeGreaterThan(2);
    // Test-only overhead camera: visual framing does not change authoritative player positions.
    await first.evaluate(()=>{const s=window.sdpUnified.modes.shooter!,c=s.camera;
      c.update=()=>{const jet=s.airstrikes.root.children.find(group=>group.visible)?.children[0];if(!jet)return;c.root.position.copy(jet.position);c.root.position.x+=14;c.root.position.y+=11;c.root.position.z+=16;c.yaw.rotation.set(0,0,0);c.pitch.rotation.set(0,0,0);c.pitch.position.set(0,0,0);c.motion.rotation.set(0,0,0);c.motion.position.set(0,0,0);c.camera.position.set(0,0,0);c.camera.lookAt(jet.position);c.root.updateMatrixWorld(true);};
    });
    await first.waitForTimeout(120);await first.screenshot({path:info.outputPath('aircraft-over-map.png')});
    local.clock.elapsedTime=strike.impactAt+20;await expect.poll(()=>local.state.players.get(victim)!.dead).toBe(true);
    await expect.poll(()=>second.evaluate(()=>window.sdpUnified.network.snapshot!.players.find(p=>p.playerId===window.sdpUnified.network.snapshot!.localPlayerId)?.dead)).toBe(true);
    await expect.poll(()=>first.evaluate(()=>{const meter=(window as Window&{strikeMeter?:AnalyserNode}).strikeMeter!,samples=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs));}),{timeout:1500,intervals:[20,40,60]}).toBeGreaterThan(.0001);
    await expect.poll(()=>first.evaluate(()=>window.sdpUnified.modes.shooter!.airstrikes.root.children.some(group=>group.visible&&group.children[3].visible))).toBe(true);
    await first.evaluate((flight:AirstrikeFlight)=>{const c=window.sdpUnified.modes.shooter!.camera;
      c.update=()=>{c.root.position.set(flight.x+9,flight.y+12,flight.z+12);c.yaw.rotation.set(0,0,0);c.pitch.rotation.set(0,0,0);c.pitch.position.set(0,0,0);c.motion.rotation.set(0,0,0);c.motion.position.set(0,0,0);c.camera.position.set(0,0,0);c.camera.lookAt(flight.x,flight.y,flight.z);c.root.updateMatrixWorld(true);};
    },strike.toJSON() as unknown as AirstrikeFlight);
    await first.waitForTimeout(100);await first.screenshot({path:info.outputPath('white-impact.png')});
    expect(await first.evaluate(()=>{
      const s=window.sdpUnified.modes.shooter!,r=window.sdpUnified.scene.renderer,gl=r.getContext(),n=gl.drawingBufferWidth*gl.drawingBufferHeight*4,a=new Uint8Array(n),b=new Uint8Array(n);
      s.camera.camera.layers.set(0);r.render(s.scene,s.camera.camera);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,a);
      s.airstrikes.root.visible=false;r.render(s.scene,s.camera.camera);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,b);s.airstrikes.root.visible=true;
      let changed=0;for(let i=0;i<n;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>12)changed++;return changed;
    })).toBeGreaterThan(400);
    expect(local.state.killFeed.some(k=>k.region==='blast')).toBe(true);expect(local.state.players.get(owner)!.strikes).toBe(0);
    await first.evaluate(()=>(window as Window&{strikeMeter?:AnalyserNode}).strikeMeter!.disconnect());
    earnThree(local,owner,victim);await expect(first.getByRole('button',{name:'Deploy airstrike 2',exact:true})).toBeEnabled();
    await first.keyboard.press('Digit2');await expect(first.locator('.airstrike-map')).toHaveAttribute('data-phase','open');
    expect(await first.evaluate(()=>window.sdpUnified.modes.shooter!.targeting.slot)).toBe(2);
    local.state.players.get(owner)!.protectedUntil=0;
    inspectRoom(local).applyDamage(owner,victim,100,'head',local.clock.elapsedTime,local.state.players.get(victim)!.life);
    await expect(first.locator('.airstrike-map')).toBeHidden();await expect(first.locator('.desynchronization-state')).toBeVisible();
    local.clock.elapsedTime=local.state.players.get(owner)!.respawnAt+10;
    await expect(first.getByRole('button',{name:'RESUME',exact:true})).toBeVisible();await first.getByRole('button',{name:'RESUME',exact:true}).click();
    await expect.poll(()=>first.evaluate(()=>window.sdpUnified.modes.shooter!.input.enabled&&!!document.pointerLockElement)).toBe(true);
    await first.keyboard.press('Escape');await first.getByRole('button',{name:'RETURN TO LIMBO'}).click();await expect(first.locator('#app')).toHaveAttribute('data-mode','LIMBO');await expect(first.locator('.airstrike-map')).toHaveCount(0);await expect(first.locator('canvas.scene-canvas')).toHaveCount(1);
    expect(errors).toEqual([]);
  }finally{await a.close();await b.close();}
});
test('mobile portrait/landscape map remains readable, selects targets by touch and closes without firing',async({browser},info)=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try{
    const page=await context.newPage();await page.goto(`${url}/?debugMode=shooter`);await expect(page.locator('#app')).toHaveAttribute('data-mode','SHOOTER',{timeout:90000});await page.getByRole('button',{name:'ENTER SIMULATION'}).tap();
    const own=await page.evaluate(()=>window.sdpUnified.network.snapshot!.localPlayerId),id=await page.evaluate(()=>window.sdpUnified.network.snapshot!.roomId),local=fixture.room(id);
    // Isolated UI coverage: authority and reward earning are exercised by the other tests.
    local.state.players.get(own)!.strikes=7;
    await expect(page.getByRole('button',{name:'Deploy airstrike 1',exact:true})).toBeEnabled();
    for(const [width,height,slot] of [[390,844,1],[844,390,2],[320,568,3]]){
      await page.setViewportSize({width,height});await page.getByRole('button',{name:`Deploy airstrike ${slot}`,exact:true}).tap();await expect(page.locator('.airstrike-map')).toHaveAttribute('data-phase','open');
      expect(await page.evaluate(()=>window.sdpUnified.modes.shooter!.targeting.slot)).toBe(slot);
      await expect(page.locator('.touch-controls')).toBeHidden();
      const values=await page.locator('.airstrike-map header,.airstrike-map footer,.strike-map-sheet').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
      for(const r of values){expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThanOrEqual(0);expect(r.right).toBeLessThanOrEqual(width+1);expect(r.bottom).toBeLessThanOrEqual(height+1);}
      const point=local.state.players.get(own)!,uv=await page.evaluate(({x,z})=>{const b=window.sdpUnified.modes.shooter!.targeting.bounds;return{u:.5+(x-b.centerX)/b.span,v:.5+(z-b.centerZ)/b.span};},point);
      const rect=(await page.locator('.strike-map-terrain').boundingBox())!,driver=await touchDriver(page);await driver.down(1,rect.x+uv.u*rect.width,rect.y+uv.v*rect.height);await driver.up(1);
      await expect(page.locator('.strike-map-marker')).toBeVisible();await page.screenshot({path:info.outputPath(`map-${width}x${height}.png`)});
      const ammo=point.ammo;await page.getByRole('button',{name:'Close targeting map'}).tap();await expect(page.locator('.airstrike-map')).toBeHidden();await expect(page.locator('.touch-stick')).toBeVisible();expect(local.state.players.get(own)!.ammo).toBe(ammo);
      await page.keyboard.press('Enter');await expect(page.getByRole('textbox',{name:'Chat message'})).toBeVisible();expect(local.state.airstrikes.length).toBe(0);await page.keyboard.press('Escape');
    }
  }finally{await context.close();}
});

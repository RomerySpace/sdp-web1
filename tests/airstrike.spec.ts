import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { createServer as netServer } from 'node:net';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { airstrikeFixture, earnThree, inspectRoom } from '../server/tests/airstrike-fixture';
import { touchDriver } from './touch-driver';
import type { AirstrikeFlight } from '../shared/AirstrikeProtocol';
import type { Mesh, MeshBasicMaterial } from 'three';
let fixture: Awaited<ReturnType<typeof airstrikeFixture>>, vite:ViteDevServer, url:string;
async function freePort():Promise<number>{const server=netServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port;}
test.beforeAll(async()=>{
  fixture=await airstrikeFixture();const port=await freePort();
  Object.assign(process.env,{SDP_BACKEND_PORT:String(fixture.port),SDP_WEB_PORT:String(port),VITE_SDP_SERVER_URL:'/multiplayer'});
  vite=await createServer({root:resolve(process.cwd()),mode:'unified',server:{host:'127.0.0.1',port,strictPort:true}});await vite.listen();url=`http://127.0.0.1:${port}`;
});
test.afterAll(async()=>{await vite?.close();await fixture?.server.gracefullyShutdown(false);});
async function expectReadyWeapon(page:Page):Promise<void> {
  await expect.poll(()=>page.evaluate(()=>{
    const s=window.sdpUnified.modes.shooter!,root=s.weapon.root;
    return !s.targeting.visible&&root.visible&&root.position.length()<.001&&Math.abs(root.rotation.x)<.001&&s.input.enabled;
  })).toBe(true);
  expect(await page.evaluate(()=>{
    const s=window.sdpUnified.modes.shooter!,r=window.sdpUnified.scene.renderer,gl=r.getContext(),n=gl.drawingBufferWidth*gl.drawingBufferHeight*4,a=new Uint8Array(n),b=new Uint8Array(n),background=s.scene.background;
    const render=(visible:boolean,buffer:Uint8Array)=>{
      s.weapon.root.visible=visible;s.scene.background=background;s.camera.camera.layers.set(0);r.clear();r.render(s.scene,s.camera.camera);
      s.scene.background=null;r.clearDepth();s.camera.camera.layers.set(1);r.render(s.scene,s.camera.camera);
      gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,buffer);
    };
    render(true,a);render(false,b);s.weapon.root.visible=true;s.scene.background=background;s.camera.camera.layers.set(0);
    let changed=0;for(let i=0;i<n;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>10)changed++;return changed;
  })).toBeGreaterThan(30);
}
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
    // Holding the map used to accumulate the root transform until the pistol vanished.
    for(let cycle=0;cycle<2;cycle++){
      await first.keyboard.press('Digit1');await expect(first.locator('.airstrike-map')).toHaveAttribute('data-phase','open');
      await first.waitForTimeout(500);
      expect(await first.evaluate(()=>window.sdpUnified.modes.shooter!.weapon.root.position.y)).toBeCloseTo(-.65);
      await first.keyboard.press('Escape');await expect(first.locator('.airstrike-map')).toBeHidden();await expectReadyWeapon(first);
      expect(local.state.airstrikes.length).toBe(0);
    }
    await first.keyboard.press('Digit1');await expect(first.locator('.airstrike-map')).toHaveAttribute('data-phase','open');expect(await first.evaluate(()=>document.pointerLockElement)).toBeNull();
    expect(await first.evaluate(()=>window.sdpUnified.modes.shooter!.input.enabled)).toBe(false);
    const targetPlayer=local.state.players.get(victim)!,target=inspectRoom(local).world.strikeTarget(targetPlayer.x,targetPlayer.z)!;
    const coordinates=await first.evaluate(({x,z})=>{const m=window.sdpUnified.modes.shooter!.targeting.bounds;return{u:.5+(x-m.centerX)/m.span,v:.5+(z-m.centerZ)/m.span};},target);
    const bounds=(await first.locator('.strike-map-terrain').boundingBox())!;await first.mouse.move(bounds.x+coordinates.u*bounds.width,bounds.y+coordinates.v*bounds.height);
    await expect(first.locator('.strike-map-marker')).toBeVisible();await expect(first.getByRole('button',{name:'DEPLOY AIRSTRIKE',exact:true})).toHaveCount(0);
    await first.screenshot({path:info.outputPath('tactical-map-desktop.png')});
    const image=await sharp(await first.locator('.strike-map-terrain').screenshot()).removeAlpha().raw().toBuffer();expect(new Set(image).size).toBeGreaterThan(50);
    const ammo=local.state.players.get(owner)!.ammo;await first.mouse.click(bounds.x+5,bounds.y+5);expect(local.state.players.get(owner)!.ammo).toBe(ammo);expect(local.state.airstrikes.length).toBe(0);
    await expect(first.locator('.airstrike-map')).toHaveAttribute('data-phase','open');
    // A single click commits a valid target and starts stowing immediately.
    await first.mouse.click(bounds.x+coordinates.u*bounds.width,bounds.y+coordinates.v*bounds.height);
    await expect.poll(()=>local.state.airstrikes.length).toBe(1);await expect(first.locator('.airstrike-map')).toBeHidden();
    await expectReadyWeapon(first);expect(local.state.players.get(owner)!.ammo).toBe(ammo);
    await first.screenshot({path:info.outputPath('pistol-restored-after-launch.png')});
    await first.mouse.click(720,500);await expect.poll(()=>local.state.players.get(owner)!.ammo).toBe(ammo-1);
    await first.keyboard.press('KeyR');await expect.poll(()=>local.state.players.get(owner)!.reloading).toBe(true);
    const strike=local.state.airstrikes[0];local.state.players.get(owner)!.protectedUntil=strike.impactAt+1000;
    await expect.poll(()=>second.evaluate(()=>window.sdpUnified.network.snapshot!.airstrikes?.length)).toBe(1);
    local.clock.elapsedTime=strike.releasedAt+200;
    await expect.poll(()=>first.evaluate(()=>{const root=window.sdpUnified.modes.shooter!.airstrikes.root;return root.children.some(group=>group.visible&&group.children[1].visible);})).toBe(true);
    expect(await first.evaluate(()=>{const flight=window.sdpUnified.modes.shooter!.airstrikes.root.children.find(group=>group.visible)!;return[flight.children[0].scale.x,flight.children[1].scale.x];})).toEqual([.42,1.2]);
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
      const rect=(await page.locator('.strike-map-terrain').boundingBox())!,driver=await touchDriver(page);await driver.down(1,rect.x+uv.u*rect.width,rect.y+uv.v*rect.height);
      await expect(page.locator('.strike-map-marker')).toBeVisible();await page.screenshot({path:info.outputPath(`map-${width}x${height}.png`)});
      await driver.cancel();expect(local.state.airstrikes.length).toBe(0);
      const ammo=point.ammo;await page.getByRole('button',{name:'Close targeting map'}).tap();await expect(page.locator('.airstrike-map')).toBeHidden();await expect(page.locator('.touch-stick')).toBeVisible();expect(local.state.players.get(own)!.ammo).toBe(ammo);
      await expectReadyWeapon(page);
      await page.keyboard.press('Enter');await expect(page.getByRole('textbox',{name:'Chat message'})).toBeVisible();expect(local.state.airstrikes.length).toBe(0);await page.keyboard.press('Escape');
    }
    await page.getByRole('button',{name:'Deploy airstrike 1',exact:true}).tap();await expect(page.locator('.airstrike-map')).toHaveAttribute('data-phase','open');
    const point=local.state.players.get(own)!,uv=await page.evaluate(({x,z})=>{const b=window.sdpUnified.modes.shooter!.targeting.bounds;return{u:.5+(x-b.centerX)/b.span,v:.5+(z-b.centerZ)/b.span};},point);
    const rect=(await page.locator('.strike-map-terrain').boundingBox())!,ammo=point.ammo;
    await page.touchscreen.tap(rect.x+uv.u*rect.width,rect.y+uv.v*rect.height);
    await expect.poll(()=>local.state.airstrikes.length).toBe(1);await expectReadyWeapon(page);expect(point.ammo).toBe(ammo);await expect(page.locator('.touch-stick')).toBeVisible();
  }finally{await context.close();}
});
test('all 29 media positions have the decoded test poster and a complete supporting wall',async({browser},info)=>{
  const context=await browser.newContext({viewport:{width:960,height:720}});
  try{
    const page=await context.newPage();await page.goto(`${url}/?debugMode=shooter`);
    await expect(page.locator('#app')).toHaveAttribute('data-mode','SHOOTER',{timeout:90000});
    await page.getByRole('button',{name:'ENTER SIMULATION'}).click();
    const audit=await page.evaluate(async()=>{
      const s=window.sdpUnified.modes.shooter!,slots=await(await fetch('/ads/slots.json')).json() as {id:string;size:[number,number]}[];
      const textures=new Set<string>(),hashes=new Set<number>(),unsupported:string[]=[],undecoded:string[]=[];
      for(const slot of slots){
        const placement=s.media.placements.find(p=>p.id===slot.id),group=s.media.root.children.find(p=>p.name===`media:${slot.id}`);
        if(!placement||!group){unsupported.push(slot.id);continue;}
        const screen=group.children.at(-1) as Mesh,texture=(screen.material as MeshBasicMaterial).map!,image=texture.image as HTMLImageElement;
        textures.add(texture.uuid);
        if(placement.content!=='loaded'||image.naturalWidth!==768||image.naturalHeight!==961){undecoded.push(slot.id);continue;}
        const canvas=document.createElement('canvas');canvas.width=128;canvas.height=160;
        const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0,128,160);
        const pixels=ctx.getImageData(0,0,128,160).data;let hash=2166136261;for(const byte of pixels)hash=Math.imul(hash^byte,16777619);hashes.add(hash);
        const normal=s.camera.root.position.clone().fromArray(placement.normal),up=normal.clone().set(0,1,0),right=up.clone().cross(normal).normalize();
        for(const x of [-1,-.5,0,.5,1])for(const y of [-1,-.5,0,.5,1]){
          const origin=group.position.clone().addScaledVector(normal,.265).addScaledVector(right,x*slot.size[0]/2).addScaledVector(up,y*slot.size[1]/2);
          const hit=s.physics!.ray(origin,normal.clone().negate(),.5,s.player!.collider);
          if(!hit||Math.abs(hit.toi-.3)>.05)unsupported.push(slot.id);
        }
      }
      return{configured:slots.length,mounted:s.media.placements.length,skipped:s.media.skipped,unsupported,undecoded,textureCount:textures.size,imageVariants:hashes.size,ids:slots.map(p=>p.id)};
    });
    expect(audit).toMatchObject({configured:29,mounted:29,skipped:[],unsupported:[],undecoded:[],textureCount:15,imageVariants:1});
    const views:Buffer[]=[];
    for(const id of audit.ids){
      await page.evaluate(id=>{
        const s=window.sdpUnified.modes.shooter!,target=s.media.root.children.find(p=>p.name===`media:${id}`)!,placement=s.media.placements.find(p=>p.id===id)!,c=s.camera;
        s.weapon.root.visible=false;
        c.update=()=>{
          const normal=c.root.position.clone().fromArray(placement.normal),origin=target.position.clone().addScaledVector(normal,.1);
          const opposite=s.physics!.ray(origin,normal,3.5,s.player!.collider),distance=Math.min(2.8,opposite?Math.max(.2,opposite.toi-.15):2.8);
          c.root.position.copy(origin).addScaledVector(normal,distance);
          c.yaw.rotation.set(0,0,0);c.pitch.rotation.set(0,0,0);c.pitch.position.set(0,0,0);c.motion.rotation.set(0,0,0);c.motion.position.set(0,0,0);
          c.camera.position.set(0,0,0);c.camera.fov=48;c.camera.updateProjectionMatrix();c.camera.lookAt(target.position);c.root.updateMatrixWorld(true);
        };
      },id);
      await page.waitForTimeout(100);const frame=await page.locator('canvas.scene-canvas').screenshot();
      const crop=await sharp(frame).extract({left:360,top:200,width:240,height:320}).removeAlpha().raw().toBuffer();expect(new Set(crop).size,id).toBeGreaterThan(30);
      views.push(await sharp(frame).resize(320,240).png().toBuffer());
    }
    await sharp({create:{width:1600,height:1440,channels:3,background:'#ffffff'}}).composite(views.map((input,i)=>({input,left:i%5*320,top:Math.floor(i/5)*240}))).png().toFile(info.outputPath('all-29-test-posters.png'));
  }finally{await context.close();}
});

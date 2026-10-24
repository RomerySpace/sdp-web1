import { expect,test } from '@playwright/test';
import { enterExhibition } from './entry';
test('liminal update: lobby, jump, chat, inspection, shader compilation, media walls and lean',async({page})=> {
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error'&&/shader|GL_INVALID|WebGLProgram/.test(m.text()))errors.push(m.text());});
 await page.goto('/?debugMode=limbo');await expect(page.locator('.ui')).toHaveAttribute('data-sculpture','loaded');await enterExhibition(page,'Liminal Tester');
 await page.waitForTimeout(1700); await page.addStyleTag({content:'.mode-diagnostics { display:none !important; }'});
 await page.screenshot({path:'test-results/liminal-lobby.png'});
 await page.keyboard.press('Space');await page.waitForTimeout(180);
 expect(await page.evaluate(()=>window.sdpUnified.player.camera.position.y)).toBeGreaterThan(1.9);
 await page.waitForTimeout(1100);expect(await page.evaluate(()=>window.sdpUnified.player.camera.position.y)).toBeCloseTo(1.7,1);
 await page.keyboard.press('Enter');await expect(page.locator('.ui')).toHaveAttribute('data-state','CHATTING');
 await expect(page.locator('.controls-overlay')).toBeHidden();
 await page.screenshot({path:'test-results/liminal-chat.png'});await page.keyboard.press('Escape');
 await expect(page.locator('.ui')).toHaveAttribute('data-state','EXPLORING');
 await page.evaluate(()=>{const camera=window.sdpUnified.player.camera;camera.position.set(0,1.7,2.7);camera.rotation.set(0,0,0);});
 await expect(page.getByRole('button',{name:'Interact with sculpture'})).toBeVisible();await page.keyboard.press('KeyE');
 await expect(page.getByRole('button',{name:'JOIN SUBASTA — próximamente'})).toBeDisabled();
 await page.screenshot({path:'test-results/liminal-inspection.png'});
 await page.getByRole('button',{name:'JOIN SHOOTER',exact:true}).click();await expect(page.locator('#app')).toHaveAttribute('data-mode','SHOOTER');
 await page.getByRole('button',{name:'ENTER SIMULATION'}).click();
 await expect.poll(()=>page.evaluate(()=>window.sdpUnified.modes.shooter?.paused)).toBe(false);
 await page.keyboard.down('KeyQ');await page.waitForTimeout(400);
 expect(await page.evaluate(()=>window.sdpUnified.modes.shooter!.camera.motion.rotation.z)).toBeGreaterThan(.1);
 await page.keyboard.up('KeyQ');await page.waitForTimeout(400);
 expect(Math.abs(await page.evaluate(()=>window.sdpUnified.modes.shooter!.camera.motion.rotation.z))).toBeLessThan(.03);
 const placements=await page.evaluate(()=>window.sdpUnified.modes.shooter!.media.placements);console.log('MEDIA PLACEMENTS',JSON.stringify(placements));expect(placements.length).toBeGreaterThan(0);
 expect(await page.evaluate(()=>window.sdpUnified.modes.shooter!.scene.userData.lighting)).toBe('day');
 await page.screenshot({path:'test-results/liminal-day.png'});
 const timer=await page.locator('.shooter-round').boundingBox();expect(Math.abs(timer!.x+timer!.width/2-720)).toBeLessThan(2);
 expect(errors).toEqual([]);
});

test('music title/artist and shared position persist from lobby to shooter',async({browser})=> {
 const context=await browser.newContext(),secondContext=await browser.newContext(),a=await context.newPage(),b=await secondContext.newPage();
 const sampleRate=8000,seconds=60,data=Buffer.alloc(44+sampleRate*seconds);
 data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(sampleRate,24);data.writeUInt32LE(sampleRate,28);data.writeUInt16LE(1,32);data.writeUInt16LE(8,34);data.write('data',36);data.writeUInt32LE(sampleRate*seconds,40);
 for(let i=44;i<data.length;i++)data[i]=128+Math.round(12*Math.sin(i*.2));
 for (const testContext of [context,secondContext]) {
 await testContext.route('**/audio/playlist.json',route=>route.fulfill({json:[{id:'fixture',title:'Test Broadcast',artist:'Test Artist',url:'/audio/test.wav',duration:seconds}]}));
 await testContext.route('**/audio/test.wav',route=>route.fulfill({contentType:'audio/wav',body:data}));
 await testContext.addInitScript(()=> {
  const original=AudioContext.prototype.createMediaElementSource;
  AudioContext.prototype.createMediaElementSource=function(media){Object.assign(window,{testMusic:media});return original.call(this,media);};
 });
 }
 const position=async(page:import('@playwright/test').Page)=>page.evaluate(()=> (window as unknown as {testMusic:HTMLAudioElement}).testMusic.currentTime);
 try {
  await a.goto('/?debugMode=limbo');await enterExhibition(a,'Music A');await expect(a.locator('.music-title')).toHaveText('Test Broadcast');await expect(a.locator('.now-playing')).toBeVisible();
  await b.goto('/?debugMode=limbo');await enterExhibition(b,'Music B');await expect(b.locator('.music-artist')).toHaveText('Test Artist');await expect(b.locator('.now-playing')).toBeVisible();
  await expect.poll(async()=>Math.min(Math.abs(await position(a)-await position(b)),60-Math.abs(await position(a)-await position(b)))).toBeLessThan(.8);
  await b.evaluate(()=>window.sdpUnified.modes.joinShooter());await expect(b.locator('#app')).toHaveAttribute('data-mode','SHOOTER');
  await b.getByRole('button',{name:'ENTER SIMULATION'}).click();await expect(b.locator('.now-playing')).toBeVisible();
  await expect.poll(async()=>Math.abs(await position(a)-await position(b))).toBeLessThan(.8);
 } finally {await context.close();await secondContext.close();}
});

test('eliminations keep the score and feed without streak rewards or large announcements',async({page})=> {
 await page.goto('/?debugMode=shooter');await expect(page.locator('#app')).toHaveAttribute('data-mode','SHOOTER');
 await page.getByRole('button',{name:'ENTER SIMULATION'}).click();
 // Isolated HUD fixture: actual combat/respawn is also covered by the two-client server suite.
 await page.evaluate(async()=> {
  const {ShooterHUD}=await import(/* @vite-ignore */ '/src/modes/shooter/ui/' + 'ShooterHUD.ts');
  const hud=new ShooterHUD(document.body,()=>{});hud.element.hidden=false;hud.element.id='hud-fixture';
  Object.assign(window,{testHud:hud});
  const player={playerId:'a',x:0,y:0,z:0,yaw:0,pitch:0,connected:true,lastProcessedInput:0,kills:0,deaths:0};
  const snapshot={roomId:'fixture',localPlayerId:'a',tick:0,receivedAt:0,serverTime:0,players:[player],killFeed:[],match:{phase:'playing' as const,round:1,endsAt:300000,nextRoundAt:0,results:[]}};
  Object.assign(window,{testSnapshot:snapshot});hud.receive(snapshot);
 });
 for(const tier of [3,7,12]) {
  await page.evaluate((tier)=> {
   const fixture=window as unknown as {testHud:import('../src/modes/shooter/ui/ShooterHUD').ShooterHUD;testSnapshot:import('../shared/MultiplayerProtocol').LobbySnapshot};
   const snapshot={...fixture.testSnapshot,players:[{...fixture.testSnapshot.players[0],kills:tier}],killFeed:[{id:String(tier),attackerId:'a',victimId:'b',attackerName:'Player A',victimName:'Player B',region:'torso' as const,timestamp:tier}]};
   fixture.testHud.receive(snapshot);const game=window.sdpUnified.modes.shooter!;fixture.testHud.update(game.player!,game.weapon,100,false);
  },tier);
  await expect(page.locator('#hud-fixture .shooter-record')).toContainText(`${tier} K / 0 D`);
  await expect(page.locator('#hud-fixture .shooter-kill-feed')).toContainText(/Player A.*KILLED.*Player B/);
  await expect(page.locator('#hud-fixture .kill-announcement, #hud-fixture .streak-meter')).toHaveCount(0);
 }
 await page.screenshot({path:'test-results/clean-shooter-score.png'});
 await page.evaluate(()=>{const fixture=window as unknown as {testHud:import('../src/modes/shooter/ui/ShooterHUD').ShooterHUD};fixture.testHud.dispose();});
});

test('physical lean moves eye position, replicates exposed head, and keeps pitch pivot at eye level', async ({ browser }) => {
 const ca=await browser.newContext(),cb=await browser.newContext(),a=await ca.newPage(),b=await cb.newPage();
 try {
  for(const page of [a,b]) {
   await page.goto('/?debugMode=shooter');await expect(page.locator('#app')).toHaveAttribute('data-mode','SHOOTER');
   await page.getByRole('button',{name:'ENTER SIMULATION'}).click();
  }
  await expect.poll(()=>b.evaluate(()=>window.sdpUnified.modes.shooter!.remotes.count)).toBeGreaterThanOrEqual(1);
  await a.bringToFront();
  // Focus changes may pause the first tab; resume through its normal UI.
  if(await a.evaluate(()=>window.sdpUnified.modes.shooter!.paused))await a.getByRole('button',{name:/RESUME|ENTER SIMULATION/}).click();
  const id=await a.evaluate(()=>window.sdpUnified.network.snapshot!.localPlayerId);
  const eye=()=>a.evaluate(()=>{const s=window.sdpUnified.modes.shooter!,v=s.camera.camera.getWorldPosition(s.camera.aimDirection.clone());return {x:v.x,y:v.y,z:v.z,lean:s.player!.lean,yaw:s.input.yaw};});
  await a.evaluate(async()=> {
   const {RAPIER,identityRotation}=await import(/* @vite-ignore */ '/src/modes/shooter/physics/'+'PhysicsWorld.ts');
   const s=window.sdpUnified.modes.shooter!,p=s.player!,origin={x:p.current.x,y:p.current.y+p.height/2-.1,z:p.current.z};
   for(let i=0;i<32;i++) {
    const yaw=i*Math.PI/16;
    const clear=[-1,1].every(sign=>!p.physics.world.castShape(origin,identityRotation,{x:Math.cos(yaw)*sign*.5,y:-.06,z:-Math.sin(yaw)*sign*.5},new RAPIER.Ball(.22),1,true,RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,undefined,p.collider,p.body));
    if(clear){s.input.yaw=yaw;return;}
   }
   throw new Error('No clear direction for lean fixture at current spawn');
  });
  await a.waitForTimeout(150);
  const center=await eye();
  for(const [key,sign] of [['KeyQ',-1],['KeyE',1]] as const) {
   await a.keyboard.down(key);
   await expect.poll(async()=>sign*(await eye()).lean).toBeGreaterThan(.42);
   const exposed=await eye();
   const lateral=(exposed.x-center.x)*Math.cos(center.yaw)-(exposed.z-center.z)*Math.sin(center.yaw);
   expect(sign*lateral).toBeGreaterThan(.4);
   await expect.poll(()=>b.evaluate(({id,sign})=>sign*(window.sdpUnified.network.snapshot!.players.find(p=>p.playerId===id)?.lean??0),{id,sign})).toBeGreaterThan(.4);
   await expect.poll(()=>b.evaluate(({id,sign})=>{const remotes=window.sdpUnified.modes.shooter!.remotes as unknown as {remotes:Map<string,{head:{position:{x:number}}}>};return sign*(remotes.remotes.get(id!)?.head.position.x??0);},{id,sign})).toBeGreaterThan(.38);
   await a.keyboard.up(key);await expect.poll(async()=>Math.abs((await eye()).lean)).toBeLessThan(.01);
  }
  const before=await eye();await a.evaluate(()=>{window.sdpUnified.modes.shooter!.input.pitch=1.1;});await a.waitForTimeout(150);
  const after=await eye();expect(Math.hypot(after.x-before.x,after.z-before.z)).toBeLessThan(.04);expect(Math.abs(after.y-before.y)).toBeLessThan(.04);
 } finally {await ca.close();await cb.close();}
});

test('grass stays continuous beyond the former field boundary',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/shader|WebGLProgram/.test(m.text()))errors.push(m.text());});
 await page.goto('/?debugMode=limbo');await enterExhibition(page,'Garden Walk');await page.waitForTimeout(1700);
 await page.addStyleTag({content:'.mode-diagnostics { display:none !important; }'});
 await page.evaluate(()=>{
  const app=window.sdpUnified,p=app.network.snapshot!.players.find(p=>p.playerId===app.network.snapshot!.localPlayerId)!;
  app.player.setSpawn({...p,x:70,y:1.7,z:60,yaw:1.1,pitch:0});
  // Keep this visual fixture isolated from server position corrections.
  app.network.disconnect();
 });
 await page.waitForTimeout(250);await page.screenshot({path:'test-results/liminal-grass-far.png'});
 const count=await page.evaluate(()=>window.sdpUnified.scene.scene.children.filter(o=>o.name.startsWith('White grass')).length);expect(count).toBe(2);expect(errors).toEqual([]);
});

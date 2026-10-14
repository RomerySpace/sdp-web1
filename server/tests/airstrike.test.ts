import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, type Room } from '@colyseus/sdk';
import { airstrikeConfig, blastDamage, earnedStrikeMask, validateAirstrikeRequest, type AirstrikeResult } from '../../shared/AirstrikeProtocol';
import type { ShooterState } from '../src/state/ShooterState';
import { ShooterWorld } from '../src/simulation/ShooterWorld';
import { RAPIER } from '../../src/modes/shooter/physics/PhysicsWorld';
import { airstrikeFixture, earnThree, inspectRoom } from './airstrike-fixture';
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(check:()=>boolean){const end=Date.now()+6000;while(!check()){if(Date.now()>end)throw new Error('Airstrike synchronization timed out');await sleep(20);}}
test('airstrike requests are bounded, contain no damage/identity/height, and charge thresholds are explicit',()=>{
  const valid={seq:1,life:1,slot:1,x:30,z:-20};assert.ok(validateAirstrikeRequest(valid));
  for(const bad of [{...valid,y:0},{...valid,damage:999},{...valid,ownerId:'forged'},{...valid,x:NaN},{...valid,z:Infinity},{...valid,slot:4},{...valid,life:0},{...valid,seq:1.5}])assert.equal(validateAirstrikeRequest(bad),null);
  assert.equal(earnedStrikeMask(2),0);assert.equal(earnedStrikeMask(3),1);assert.equal(earnedStrikeMask(7),3);assert.equal(earnedStrikeMask(12),7);
  assert.equal(blastDamage(0),120);assert.equal(blastDamage(3),120);assert.equal(blastDamage(6.5),60);assert.equal(blastDamage(10),0);assert.equal(blastDamage(NaN),0);
});
test('late impact still resolves once, self-blast never grants a kill, old lives and round-ending flights are rejected', {timeout:20000},async()=>{
  const fixture=await airstrikeFixture(),client=new Client(`http://127.0.0.1:${fixture.port}`),rooms:Room<ShooterState>[]=[];
  try{
    const a=await client.joinOrCreate<ShooterState>('SDPShooterRoom',{displayName:'Self blast'}),b=await client.joinById<ShooterState>(a.roomId,{displayName:'Witness'});rooms.push(a,b);
    for(const room of rooms){room.reconnection.enabled=false;room.onMessage('combat:ping',nonce=>room.send('combat:pong',nonce));room.onMessage('combat:event',()=>{});}
    let result:AirstrikeResult|undefined;a.onMessage<AirstrikeResult>('strike:result',r=>result=r);
    const local=fixture.room(a.roomId);earnThree(local,a.sessionId,b.sessionId);
    const owner=local.state.players.get(a.sessionId)!,witness=local.state.players.get(b.sessionId)!;
    assert.ok(Math.hypot(owner.x-witness.x,owner.z-witness.z)>airstrikeConfig.radius);
    a.send('strike:request',{seq:1,life:owner.life,slot:1,x:owner.x,z:owner.z});await waitFor(()=>result?.accepted===true);
    const flight=local.state.airstrikes[0];assert.ok(owner.protectedUntil<=flight.startedAt);
    local.clock.elapsedTime=flight.finishedAt+10;
    await waitFor(()=>owner.dead);assert.equal(owner.health,0);assert.equal(owner.kills,3);assert.equal(owner.deaths,1);assert.equal(owner.streak,0);assert.equal(local.state.airstrikes.length,0);
    assert.equal(witness.health,100);await sleep(60);assert.equal(owner.deaths,1);
    const oldLife=owner.life;local.clock.elapsedTime=owner.respawnAt+10;await waitFor(()=>!owner.dead);assert.equal(owner.health,100);
    result=undefined;a.send('strike:request',{seq:2,life:oldLife,slot:1,x:owner.x,z:owner.z});await waitFor(()=>!!result);assert.equal(result!.accepted,false);
    earnThree(local,a.sessionId,b.sessionId);result=undefined;
    a.send('strike:request',{seq:3,life:owner.life,slot:1,x:witness.x,z:witness.z});await waitFor(()=>result?.accepted===true);
    local.clock.elapsedTime=local.state.matchEndsAt+10;await waitFor(()=>local.state.match==='results');assert.equal(local.state.airstrikes.length,0);assert.equal(witness.health,100);
  }finally{for(const room of rooms){room.reconnection.enabled=false;if(room.connection.isOpen)await room.leave().catch(()=>{});room.connection.close();}await fixture.server.gracefullyShutdown(false);}
});
test('real Dust 2 target heights are server raycasts and walls block blast exposure',async()=>{
  const world=await ShooterWorld.create();try{
    const a=world.add('a',0),b=world.add('b',1),point=world.strikeTarget(a.spawn.x,a.spawn.z);assert.ok(point);assert.ok(Math.abs(point.y-(a.spawn.y-.06))<.1);
    assert.equal(world.strikeTarget(499,499),null);
    const origin={x:a.spawn.x,y:point.y+.16,z:a.spawn.z},target={x:b.spawn.x,y:b.spawn.y,z:b.spawn.z,height:1.8};assert.equal(world.blastVisible(origin,target),true);
    const wall=world.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(.15,3,8).setTranslation((origin.x+target.x)/2,point.y+3,(origin.z+target.z)/2));world.physics.world.updateSceneQueries();
    assert.equal(world.blastVisible(origin,target),false);world.physics.world.removeCollider(wall,true);
    const roof=world.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(2,.15,2).setTranslation(origin.x,25,origin.z));world.physics.world.updateSceneQueries();
    const roofTarget=world.strikeTarget(origin.x,origin.z)!;assert.ok(Math.abs(roofTarget.y-25.15)<.01);
    assert.equal(world.blastVisible({...roofTarget,y:roofTarget.y+.16},{x:origin.x,y:point.y,z:origin.z,height:1.8}),false);
    world.physics.world.removeCollider(roof,true);
  }finally{world.dispose();}
});
test('two real clients: unearned/replayed rewards rejected, one charge consumed, impact/health/death/respawn synchronized', {timeout:25000},async()=>{
  const fixture=await airstrikeFixture(),client=new Client(`http://127.0.0.1:${fixture.port}`),rooms:Room<ShooterState>[]=[];
  try{
    const a=await client.joinOrCreate<ShooterState>('SDPShooterRoom',{displayName:'Airstrike One'});rooms.push(a);
    const b=await client.joinById<ShooterState>(a.roomId,{displayName:'Airstrike Two'});rooms.push(b);
    for(const room of rooms){room.reconnection.enabled=false;room.onMessage('combat:ping',nonce=>room.send('combat:pong',nonce));room.onMessage('combat:event',()=>{});room.onMessage('weapon:event',()=>{});}
    let result:AirstrikeResult|undefined;a.onMessage<AirstrikeResult>('strike:result',r=>result=r);
    await waitFor(()=>!!a.state.players?.get(b.sessionId));const local=fixture.room(a.roomId),internal=inspectRoom(local);
    const target=internal.world.strikeTarget(local.state.players.get(b.sessionId)!.x,local.state.players.get(b.sessionId)!.z)!;
    a.send('strike:request',{seq:1,life:1,slot:1,x:target.x,z:target.z});await waitFor(()=>!!result);assert.equal(result!.accepted,false);assert.equal(local.state.airstrikes.length,0);
    earnThree(local,a.sessionId,b.sessionId);await waitFor(()=>a.state.players.get(a.sessionId)!.strikes===1);assert.equal(a.state.players.get(a.sessionId)!.streak,3);
    await sleep(360);result=undefined;a.send('strike:request',{seq:2,life:1,slot:1,x:499,z:499});await waitFor(()=>!!result);assert.equal(result!.accepted,false);assert.equal(local.state.players.get(a.sessionId)!.strikes,1);
    const victim=local.state.players.get(b.sessionId)!,chosen=internal.world.strikeTarget(victim.x,victim.z)!;
    await sleep(360);result=undefined;a.send('strike:request',{seq:3,life:1,slot:1,x:chosen.x,z:chosen.z});await waitFor(()=>result?.accepted===true);await waitFor(()=>b.state.airstrikes.length===1);
    assert.equal(local.state.players.get(a.sessionId)!.strikes,0);const strike=local.state.airstrikes[0];assert.equal(b.state.airstrikes[0].id,strike.id);
    const late=await client.joinById<ShooterState>(a.roomId,{displayName:'Late visitor'});rooms.push(late);late.onMessage('combat:ping',nonce=>late.send('combat:pong',nonce));late.onMessage('combat:event',()=>{});
    await waitFor(()=>late.state.airstrikes?.length===1);assert.equal(late.state.airstrikes[0].id,strike.id);
    const separate=await client.create<ShooterState>('SDPShooterRoom',{displayName:'Other room'});rooms.push(separate);separate.onMessage('combat:ping',nonce=>separate.send('combat:pong',nonce));separate.onMessage('combat:event',()=>{});
    await waitFor(()=>!!separate.state.players?.get(separate.sessionId));assert.equal(separate.state.airstrikes.length,0);
    a.send('strike:request',{seq:3,life:1,slot:1,x:chosen.x,z:chosen.z});await sleep(60);assert.equal(local.state.airstrikes.length,1);
    // Keep the owner outside their own blast so attribution can be asserted separately.
    local.state.players.get(a.sessionId)!.protectedUntil=strike.impactAt+1000;
    local.state.players.get(late.sessionId)!.protectedUntil=strike.impactAt+1000;
    local.clock.elapsedTime=strike.impactAt-80;await sleep(20);assert.equal(local.state.players.get(b.sessionId)!.dead,false);
    local.clock.elapsedTime=strike.impactAt+5;await waitFor(()=>b.state.players.get(b.sessionId)!.dead);
    assert.equal(b.state.players.get(b.sessionId)!.health,0);assert.ok(b.state.killFeed.some(record=>record.region==='blast'));
    assert.equal(separate.state.players.get(separate.sessionId)!.health,100);assert.equal(separate.state.killFeed.length,0);
    const deaths=b.state.players.get(b.sessionId)!.deaths;await sleep(60);assert.equal(b.state.players.get(b.sessionId)!.deaths,deaths);
    const respawnAt=local.state.players.get(b.sessionId)!.respawnAt;local.clock.elapsedTime=respawnAt+10;await waitFor(()=>!b.state.players.get(b.sessionId)!.dead);assert.equal(b.state.players.get(b.sessionId)!.health,100);
    local.clock.elapsedTime=strike.finishedAt+10;await waitFor(()=>b.state.airstrikes.length===0);
    assert.equal(strike.impactAt-strike.startedAt,(airstrikeConfig.approach+airstrikeConfig.fall)*1000);
    // Spending the 3 threshold cannot re-award it; 7 and 12 each grant their own slot.
    earnThree(local,a.sessionId,b.sessionId);assert.equal(local.state.players.get(a.sessionId)!.streak,7);assert.equal(local.state.players.get(a.sessionId)!.strikes,2);
    earnThree(local,a.sessionId,b.sessionId);assert.equal(local.state.players.get(a.sessionId)!.strikes,2);
    for(let i=0;i<2;i++){internal.respawn(b.sessionId,local.clock.elapsedTime);local.state.players.get(b.sessionId)!.protectedUntil=0;internal.applyDamage(b.sessionId,a.sessionId,100,'head',local.clock.elapsedTime,1);}
    assert.equal(local.state.players.get(a.sessionId)!.streak,12);assert.equal(local.state.players.get(a.sessionId)!.strikes,6);
    result=undefined;a.send('strike:request',{seq:4,life:999,slot:2,x:chosen.x,z:chosen.z});await waitFor(()=>!!result);assert.equal(result!.accepted,false);assert.equal(local.state.players.get(a.sessionId)!.strikes,6);
    result=undefined;a.send('strike:request',{seq:5,life:1,slot:2,x:chosen.x,z:chosen.z});await waitFor(()=>result?.accepted===true);await a.leave();
    await waitFor(()=>b.state.airstrikes.length===0);assert.ok(!local.state.players.has(a.sessionId));
  }finally{for(const room of rooms){room.reconnection.enabled=false;if(room.connection.isOpen)await room.leave().catch(()=>{});room.connection.close();}await fixture.server.gracefullyShutdown(false);}
});

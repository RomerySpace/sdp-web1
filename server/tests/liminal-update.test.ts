import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { musicPosition, MUSIC_EPOCH, validMusicTracks } from '../../shared/MusicTimeline';
import { streakProgress } from '../../shared/Streaks';
import { simulateMovement, type MotionState } from '../../shared/Movement';
import { CollisionManager } from '../../src/player/CollisionManager';
import { PhysicsWorld, RAPIER } from '../../src/modes/shooter/physics/PhysicsWorld';
import { CharacterController } from '../../src/modes/shooter/physics/CharacterController';
const input = {seq:1,f:0,r:0,y:0,p:0,active:true};
test('broadcast late join, track boundaries, wrap and malformed entries',()=> {
 const tracks=[{id:'a',title:'A',artist:'Artist',url:'/audio/a.mp3',duration:10},{id:'b',title:'B',artist:'Artist',url:'https://media.example/b.mp3',duration:20}];
 assert.deepEqual(musicPosition(tracks,MUSIC_EPOCH+12500),{track:tracks[1],offset:2.5});
 assert.deepEqual(musicPosition(tracks,MUSIC_EPOCH+30500),{track:tracks[0],offset:.5});
 assert.equal(musicPosition([],MUSIC_EPOCH),undefined);
 assert.equal(validMusicTracks([...tracks,{...tracks[0],url:'javascript:alert(1)'},{...tracks[0],duration:0}]).length,2);
});
test('3/7/12 streak progression resets on death and saturates above twelve',()=> {
 assert.equal(streakProgress(0).next,3);assert.equal(streakProgress(3).next,7);assert.equal(streakProgress(7).next,12);assert.equal(streakProgress(12).progress,1);assert.equal(streakProgress(25).next,undefined);
});
test('lobby jump lands without auto-bunnyhop and crouch caps sprint',()=> {
 const state:MotionState={x:10,z:10,velocityX:0,velocityZ:0},world=new CollisionManager();
 simulateMovement(state,{...input,j:true},.05,world);assert.ok(state.elevation!>0);
 for(let i=0;i<60;i++)simulateMovement(state,{...input,j:true},.05,world);
 assert.equal(state.elevation,0);
 simulateMovement(state,input,.05,world);simulateMovement(state,{...input,j:true},.05,world);assert.ok(state.elevation!>0);
 for(let i=0;i<80;i++)simulateMovement(state,{...input,f:1,s:true,c:true},.05,world);
 assert.ok(Math.abs(state.velocityZ)<=1.65+.001);
});
test('short treads and small seams climb without stalling, tall walls still block',async()=> {
 for(const wall of [false,true]) {
 const physics=await PhysicsWorld.initialize();
 const control={keys:new Set<string>(),forward:0,sideways:0,yaw:0,aiming:false,consume:()=>false,clear:()=>{}};
 physics.world.createCollider(RAPIER.ColliderDesc.cuboid(5,.1,8).setTranslation(0,-.1,-3));
 if(wall)physics.world.createCollider(RAPIER.ColliderDesc.cuboid(2,1,.1).setTranslation(0,1,-1));
 else for(let i=0;i<8;i++)physics.world.createCollider(RAPIER.ColliderDesc.cuboid(2,(i+1)*.085,.19).setTranslation(0,(i+1)*.085,-1-i*.385));
 const player=new CharacterController(physics,control,new Vector3(0,.03,0));
 const step=()=>{player.beforeStep(1/60,false);physics.step();player.afterStep();};
 for(let i=0;i<30;i++)step();control.forward=1;
 for(let i=0;i<220;i++)step();
 if(wall)assert.ok(player.current.z>-.9);else assert.ok(player.current.z< -3.5,`stalled at ${player.current.toArray()}`);
 player.dispose();physics.dispose();
 }
});

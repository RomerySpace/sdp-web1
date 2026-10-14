import { leanConfig, leanOffset } from '../../../shared/Lean';
import { gameplayConfig } from '../../../shared/GameplayConfig';
import { RAPIER, identityRotation } from '../../../src/modes/shooter/physics/PhysicsWorld';
import { Quaternion, Vector3 } from 'three';
import { AvatarLayout } from '../../../shared/AvatarLayout';
import type { HitRegion } from '../../../shared/ShooterProtocol';
import type { ShooterWorld } from './ShooterWorld';
export interface CombatPose { id: string; life: number; x: number; y: number; z: number; height: number;
  dead: boolean; connected: boolean; protectedUntil: number; time: number; yaw?: number; pitch?: number; reload?: number; lean?: number }
export interface PlayerHit { playerId: string; region: HitRegion; distance: number }
const layout = new AvatarLayout(), center = new Vector3(), rotation = new Quaternion(), yawRotation = new Quaternion(), axis = new Vector3(0, 1, 0);

// Detached Rapier shapes test historical targets without moving live physics bodies.
export function hitboxDistance(pose: CombatPose, ray: RAPIER.Ray, range: number): number | null {
  return regionalHit(pose, ray, range)?.distance ?? null;
}
export function regionalHit(pose: CombatPose, ray: RAPIER.Ray, range: number): PlayerHit | null {
  const broad = new RAPIER.Ball(1.5).castRay(ray, { x: pose.x, y: pose.y + pose.height / 2, z: pose.z }, identityRotation, range, true);
  if (broad < 0 || broad > range) return null;
  layout.update(pose.height, pose.pitch ?? 0, pose.reload ?? 0, pose.lean ?? 0);
  yawRotation.setFromAxisAngle(axis, pose.yaw ?? 0);
  let nearest = range, hit: PlayerHit | null = null;
  for (const part of layout.parts) {
    center.copy(part.center).applyQuaternion(yawRotation); center.x += pose.x; center.y += pose.y; center.z += pose.z;
    rotation.copy(yawRotation).multiply(part.rotation);
    const shape = part.region === 'head' ? new RAPIER.Ball(part.radius) : part.region === 'foot'
      ? new RAPIER.Cuboid(part.halfExtents.x, part.halfExtents.y, part.halfExtents.z)
      : new RAPIER.Capsule(Math.max(0, part.height / 2 - part.radius), part.radius);
    const distance = shape.castRay(ray, center, rotation, nearest, true);
    if (distance >= 0 && distance <= nearest) { nearest = distance; hit = { playerId: pose.id, region: part.region, distance }; }
  }
  return hit;
}
export class CombatSimulation {
  private readonly history = new Map<string, CombatPose[]>();
  record(poses: Iterable<CombatPose>): void {
    const present = new Set<string>();
    for (const pose of poses) {
      present.add(pose.id); const samples = this.history.get(pose.id) ?? [];
      samples.push(pose);
      while (samples.length > 1 && samples[1].time < pose.time - gameplayConfig.combat.maxRewind * 1000 - 50) samples.shift();
      this.history.set(pose.id, samples);
    }
    for (const id of this.history.keys()) if (!present.has(id)) this.history.delete(id);
  }
  private at(id: string, time: number): CombatPose | undefined {
    const samples = this.history.get(id); if (!samples?.length) return;
    let before = samples[0];
    if (time < before.time) return; // Never rewind before a player existed.
    for (const after of samples.slice(1)) {
      if (after.time >= time) {
        if (before.life !== after.life || before.dead !== after.dead) return before;
        const t = (time - before.time) / Math.max(1, after.time - before.time);
        return { ...before, x: before.x + (after.x - before.x) * t, y: before.y + (after.y - before.y) * t,
          z: before.z + (after.z - before.z) * t, height: before.height + (after.height - before.height) * t,
          yaw: (before.yaw ?? 0) + Math.atan2(Math.sin((after.yaw ?? 0) - (before.yaw ?? 0)), Math.cos((after.yaw ?? 0) - (before.yaw ?? 0))) * t,
          pitch: (before.pitch ?? 0) + ((after.pitch ?? 0) - (before.pitch ?? 0)) * t,
          lean: (before.lean ?? 0) + ((after.lean ?? 0) - (before.lean ?? 0)) * t,
          reload: (before.reload ?? 0) + ((after.reload ?? 0) - (before.reload ?? 0)) * t };
      }
      before = after;
    }
    return before;
  }
  fire(world: ShooterWorld, shooter: CombatPose, yaw: number, pitch: number, now: number, measuredRtt: number,
    current: Iterable<CombatPose>): PlayerHit | null {
    const c = gameplayConfig.combat;
    const offset = leanOffset(shooter.lean ?? 0, yaw);
    const eye = { x: shooter.x, y: shooter.y + shooter.height - .1, z: shooter.z };
    const body = world.player(shooter.id);
    const obstruction = world.physics.world.castShape(eye, identityRotation, offset, new RAPIER.Ball(leanConfig.radius),
      1, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, body?.collider, body?.body);
    const fraction = obstruction ? Math.max(0, obstruction.toi - .025) : 1;
    const origin = { x: eye.x + offset.x * fraction, y: eye.y + offset.y * fraction, z: eye.z + offset.z * fraction };
    const direction = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
    const ray = new RAPIER.Ray(origin, direction);
    // The client cannot choose a rewind timestamp. Delay comes from server-issued RTT probes.
    const time = now - Math.min(c.maxRewind * 1000, Math.max(0, measuredRtt) / 2 + c.interpolationDelay * 1000);
    let nearest = world.wallDistance(ray, c.range), target: PlayerHit | null = null;
    for (const live of current) {
      if (live.id === shooter.id || live.dead || !live.connected) continue;
      const pose = this.at(live.id, time);
      if (!pose || pose.life !== live.life || pose.dead || !pose.connected) continue;
      const hit = regionalHit(pose, ray, nearest);
      if (hit !== null && hit.distance < nearest) {
        nearest = hit.distance;
        target = now >= live.protectedUntil && time >= pose.protectedUntil ? hit : null;
      }
    }
    return target;
  }
  clear(): void { this.history.clear(); }
}

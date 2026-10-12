import { gameplayConfig } from '../../../shared/GameplayConfig';
import { RAPIER, identityRotation } from '../../../src/modes/shooter/physics/PhysicsWorld';
import type { ShooterWorld } from './ShooterWorld';
export interface CombatPose { id: string; life: number; x: number; y: number; z: number; height: number;
  dead: boolean; connected: boolean; protectedUntil: number; time: number }

// Detached Rapier shapes test historical targets without moving live physics bodies.
export function hitboxDistance(pose: CombatPose, ray: RAPIER.Ray, range: number): number | null {
  const headRadius = .19, radius = .27, bodyHeight = Math.max(.6, pose.height - headRadius * 2);
  const torso = new RAPIER.Capsule(Math.max(0, bodyHeight / 2 - radius), radius);
  const body = torso.castRay(ray, { x: pose.x, y: pose.y + bodyHeight / 2, z: pose.z }, identityRotation, range, true);
  const head = new RAPIER.Ball(headRadius).castRay(ray, { x: pose.x, y: pose.y + pose.height - headRadius, z: pose.z }, identityRotation, range, true);
  const hits = [body, head].filter(value => value >= 0 && value <= range);
  return hits.length ? Math.min(...hits) : null;
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
          z: before.z + (after.z - before.z) * t, height: before.height + (after.height - before.height) * t };
      }
      before = after;
    }
    return before;
  }
  fire(world: ShooterWorld, shooter: CombatPose, yaw: number, pitch: number, now: number, measuredRtt: number,
    current: Iterable<CombatPose>): string | null {
    const c = gameplayConfig.combat;
    const origin = { x: shooter.x, y: shooter.y + shooter.height - .1, z: shooter.z };
    const direction = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
    const ray = new RAPIER.Ray(origin, direction);
    // The client cannot choose a rewind timestamp. Delay comes from server-issued RTT probes.
    const time = now - Math.min(c.maxRewind * 1000, Math.max(0, measuredRtt) / 2 + c.interpolationDelay * 1000);
    let nearest = world.wallDistance(ray, c.range), target: string | null = null;
    for (const live of current) {
      if (live.id === shooter.id || live.dead || !live.connected) continue;
      const pose = this.at(live.id, time);
      if (!pose || pose.life !== live.life || pose.dead || !pose.connected) continue;
      const distance = hitboxDistance(pose, ray, nearest);
      if (distance !== null && distance < nearest) {
        nearest = distance;
        target = now >= live.protectedUntil && time >= pose.protectedUntil ? live.id : null;
      }
    }
    return target;
  }
  clear(): void { this.history.clear(); }
}

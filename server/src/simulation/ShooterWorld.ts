import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { setImmediate as yieldToConnections } from 'node:timers/promises';
import { PhysicsWorld, RAPIER } from '../../../src/modes/shooter/physics/PhysicsWorld';
import { CharacterController } from '../../../src/modes/shooter/physics/CharacterController';
import { decodeCollisionAsset, type CollisionAsset } from '../../../shared/ShooterCollisionAsset';
import { gameConfig } from '../../../src/modes/shooter/config/gameConfig';
import type { CharacterInput, ShooterInput } from '../../../shared/ShooterProtocol';
import { Vector3 } from 'three';

let mapData: Promise<CollisionAsset> | undefined;
class ServerInput implements CharacterInput {
  readonly keys = new Set<string>();
  yaw = 0; aiming = false; forward = 0; sideways = 0;
  private jump = false;
  apply(input: ShooterInput): void {
    this.forward = input.active ? input.f : 0; this.sideways = input.active ? input.r : 0;
    this.yaw = input.y; this.aiming = input.a;
    this.keys.clear();
    if (input.active && input.s) this.keys.add('ShiftLeft');
    if (input.active && input.c) this.keys.add('ControlLeft');
    if (input.active && input.j) this.jump = true;
    if (input.active && (input.l ?? 0) < 0) this.keys.add('KeyQ');
    if (input.active && (input.l ?? 0) > 0) this.keys.add('KeyE');
  }
  consume(code: string): boolean { if (code !== 'Space') return false; const value = this.jump; this.jump = false; return value; }
  clear(): void { this.forward = this.sideways = 0; this.keys.clear(); this.jump = false; }
}
export class ShooterWorld {
  private readonly entries = new Map<string, { input: ServerInput; player: CharacterController }>();
  private readonly spawns: Vector3[] = [];
  private spawnSequence = 0;
  private readonly bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  private constructor(readonly physics: PhysicsWorld) {}
  static async create(): Promise<ShooterWorld> {
    // Keep compact typed buffers cached, avoiding JSON strings and boxed numbers
    // during room creation on memory-constrained hosts.
    mapData ??= readFile(new URL('../../assets/dust2-colliders-v4.bin.gz', import.meta.url))
      .then(bytes => {
        const raw = gunzipSync(bytes);
        return decodeCollisionAsset(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      })
      .catch(error => { mapData = undefined; throw error; });
    const data = await mapData;
    const physics = await PhysicsWorld.initialize();
    try {
      for (const g of data.colliders) {
        physics.world.createCollider(RAPIER.ColliderDesc.trimesh(g.vertices, g.indices).setFriction(0).setRestitution(0));
        await yieldToConnections();
      }
      physics.world.updateSceneQueries();
      const world = new ShooterWorld(physics);
      for (const geometry of data.colliders) for (let i = 0; i < geometry.vertices.length; i += 3) {
        world.bounds.minX = Math.min(world.bounds.minX, geometry.vertices[i]); world.bounds.maxX = Math.max(world.bounds.maxX, geometry.vertices[i]);
        world.bounds.minZ = Math.min(world.bounds.minZ, geometry.vertices[i + 2]); world.bounds.maxZ = Math.max(world.bounds.maxZ, geometry.vertices[i + 2]);
      }
      if (data.navigation?.version !== 1 || data.navigation.connectedCells < 200) throw new Error('Regenerate validated spawn navigation with npm run prepare:shooter.');
      for (const point of data.navigation.points) world.spawns.push(new Vector3().fromArray(point));
      if (!world.spawns.length) throw new Error('No ground-level Shooter spawn is available.');
      return world;
    } catch (error) { physics.dispose(); throw error; }
  }
  add(id: string, slot: number): CharacterController {
    const spawn = this.chooseSpawn(slot, false);
    const input = new ServerInput();
    const player = new CharacterController(this.physics, input, spawn);
    this.entries.set(id, { input, player });
    return player;
  }
  input(id: string, value: ShooterInput): void { this.entries.get(id)?.input.apply(value); }
  step(reloading: (id: string) => boolean): void {
    for (const [id, entry] of this.entries) if (entry.player.body.isEnabled()) entry.player.beforeStep(gameConfig.physics.timestep, reloading(id));
    this.physics.step();
    for (const entry of this.entries.values()) if (entry.player.body.isEnabled()) entry.player.afterStep();
  }
  wallDistance(ray: RAPIER.Ray, range: number): number {
    // The imported map uses standalone colliders. Rapier 0.12 body-type flags
    // also exclude those, so filter character bodies explicitly instead.
    return this.physics.world.castRay(ray, range, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined, undefined, undefined, collider => !collider.parent() || collider.parent()!.isFixed())?.toi ?? range;
  }
  freeze(id: string): void {
    const entry = this.entries.get(id); if (!entry) return;
    entry.input.clear(); entry.player.stopHorizontal(); entry.player.body.setEnabled(false);
    this.physics.world.updateSceneQueries();
  }
  respawn(id: string): CharacterController {
    const spawn = this.chooseSpawn(this.spawnSequence++, true);
    this.remove(id);
    const input = new ServerInput(), player = new CharacterController(this.physics, input, spawn);
    this.entries.set(id, { input, player }); return player;
  }
  private chooseSpawn(slot: number, preferDistance: boolean): Vector3 {
    const p = gameConfig.player, shape = new RAPIER.Capsule(p.height / 2 - p.radius, p.radius + .04);
    const others = [...this.entries.values()].filter(e => e.player.body.isEnabled()).map(e => e.player.current);
    const candidates = this.spawns.filter(point => !this.physics.world.intersectionWithShape(
      { x: point.x, y: point.y + p.height / 2, z: point.z }, { x: 0, y: 0, z: 0, w: 1 }, shape, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS));
    if (!candidates.length) throw new Error('All ground-level Shooter spawns are occupied.');
    if (preferDistance && others.length) {
      const score = (point: Vector3) => Math.min(...others.map(other => Math.hypot(point.x - other.x, point.z - other.z)));
      candidates.sort((a, b) => score(b) - score(a));
      return candidates[0].clone();
    }
    const preferred = this.spawns[slot % this.spawns.length];
    return (candidates.includes(preferred) ? preferred : candidates[0]).clone();
  }
  player(id: string): CharacterController | undefined { return this.entries.get(id)?.player; }
  remove(id: string): void { this.entries.get(id)?.player.dispose(); this.entries.delete(id); }
  dispose(): void { this.entries.clear(); this.physics.dispose(); }
}

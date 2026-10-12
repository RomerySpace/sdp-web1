import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { PhysicsWorld, RAPIER } from '../../../src/modes/shooter/physics/PhysicsWorld';
import { CharacterController, findSpawn } from '../../../src/modes/shooter/physics/CharacterController';
import { gameConfig } from '../../../src/modes/shooter/config/gameConfig';
import type { CharacterInput, ShooterInput } from '../../../shared/ShooterProtocol';
import { Vector3 } from 'three';

interface Geometry { vertices: number[]; indices: number[] }
let mapData: Promise<{ colliders: Geometry[] }> | undefined;
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
  }
  consume(code: string): boolean { if (code !== 'Space') return false; const value = this.jump; this.jump = false; return value; }
  clear(): void { this.forward = this.sideways = 0; this.keys.clear(); this.jump = false; }
}
export class ShooterWorld {
  private readonly entries = new Map<string, { input: ServerInput; player: CharacterController }>();
  private readonly spawns: Vector3[] = [];
  private spawnSequence = 0;
  private constructor(readonly physics: PhysicsWorld) {}
  static async create(): Promise<ShooterWorld> {
    mapData ??= readFile(new URL('../../assets/dust2-colliders.json.gz', import.meta.url))
      .then(bytes => JSON.parse(gunzipSync(bytes).toString()) as { colliders: Geometry[] });
    const data = await mapData;
    const physics = await PhysicsWorld.initialize();
    try {
      for (const g of data.colliders) physics.world.createCollider(RAPIER.ColliderDesc.trimesh(Float32Array.from(g.vertices), Uint32Array.from(g.indices)).setFriction(0).setRestitution(0));
      physics.world.updateSceneQueries();
      const world = new ShooterWorld(physics);
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
        const seed = { ...gameConfig.player.spawn, x: gameConfig.player.spawn.x + Math.cos(angle) * 24, z: gameConfig.player.spawn.z + Math.sin(angle) * 24 };
        try { const spawn = findSpawn(physics, seed); if (!world.spawns.some(p => p.distanceTo(spawn) < 3)) world.spawns.push(spawn); } catch { /* Unsupported map areas are not spawn points. */ }
      }
      world.spawns.push(findSpawn(physics));
      return world;
    } catch (error) { physics.dispose(); throw error; }
  }
  add(id: string, slot: number): CharacterController {
    const seed = { ...gameConfig.player.spawn, x: gameConfig.player.spawn.x + slot % 5 * 1.4, z: gameConfig.player.spawn.z + Math.floor(slot / 5) * 1.4 };
    const spawn = findSpawn(this.physics, seed);
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
    this.remove(id);
    const p = gameConfig.player, shape = new RAPIER.Capsule(p.height / 2 - p.radius, p.radius + .04);
    const others = [...this.entries.values()].filter(e => e.player.body.isEnabled()).map(e => e.player.current);
    const candidates = this.spawns.filter(point => !this.physics.world.intersectionWithShape(
      { x: point.x, y: point.y + p.height / 2, z: point.z }, { x: 0, y: 0, z: 0, w: 1 }, shape, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS));
    const score = (point: Vector3) => others.length ? Math.min(...others.map(other => Math.hypot(point.x - other.x, point.z - other.z))) : 0;
    candidates.sort((a, b) => score(b) - score(a));
    const spawn = candidates.length ? candidates[others.length ? 0 : this.spawnSequence++ % candidates.length].clone() : findSpawn(this.physics);
    const input = new ServerInput(), player = new CharacterController(this.physics, input, spawn);
    this.entries.set(id, { input, player }); return player;
  }
  player(id: string): CharacterController | undefined { return this.entries.get(id)?.player; }
  remove(id: string): void { this.entries.get(id)?.player.dispose(); this.entries.delete(id); }
  dispose(): void { this.entries.clear(); this.physics.dispose(); }
}

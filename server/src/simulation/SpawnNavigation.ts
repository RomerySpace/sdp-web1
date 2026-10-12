import { Vector3 } from 'three';
import { PhysicsWorld, RAPIER, identityRotation } from '../../../src/modes/shooter/physics/PhysicsWorld';
import { gameConfig } from '../../../src/modes/shooter/config/gameConfig';

export interface MapColliderData { vertices: number[]; indices: number[] }
export interface SpawnNavigationData { version: number; cellSize: number; connectedCells: number; zoneCoverage: number;
  hub: number[]; points: number[][]; components: { cells: number; outdoor: number; zones: number }[] }
interface Cell { id: number; ix: number; iz: number; point: Vector3; outdoor: boolean }
const down = new Vector3(0, -1, 0), up = new Vector3(0, 1, 0);

export async function buildSpawnNavigation(colliders: MapColliderData[]): Promise<SpawnNavigationData> {
  const physics = await PhysicsWorld.initialize();
  try {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const geometry of colliders) {
      physics.world.createCollider(RAPIER.ColliderDesc.trimesh(Float32Array.from(geometry.vertices), Uint32Array.from(geometry.indices)));
      for (let i = 0; i < geometry.vertices.length; i += 3) {
        minX = Math.min(minX, geometry.vertices[i]); maxX = Math.max(maxX, geometry.vertices[i]);
        minZ = Math.min(minZ, geometry.vertices[i + 2]); maxZ = Math.max(maxZ, geometry.vertices[i + 2]);
      }
    }
    physics.world.updateSceneQueries();
    return deriveSpawnNavigation(physics, { minX, minZ, maxX, maxZ });
  } finally { physics.dispose(); }
}

export function deriveSpawnNavigation(physics: PhysicsWorld, bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): SpawnNavigationData {
  const p = gameConfig.player, size = .8, shape = new RAPIER.Capsule(p.height / 2 - p.radius, p.radius + .02);
  const cells: Cell[] = [], columns = new Map<string, Cell[]>();
  const origin = new Vector3(), center = new Vector3(), velocity = new Vector3();
  const clear = (point: Vector3) => {
    center.copy(point); center.y += p.height / 2;
    return !physics.world.intersectionWithShape(center, identityRotation, shape, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
  };
  const support = (point: Vector3) => [[-.32, 0], [.32, 0], [0, -.32], [0, .32]].every(([dx, dz]) => {
    origin.set(point.x + dx, point.y + .08, point.z + dz);
    const hit = physics.ray(origin, down, .25);
    return !!hit && hit.normal.y > .7;
  });
  for (let ix = Math.ceil(bounds.minX / size); ix <= Math.floor(bounds.maxX / size); ix++) {
    for (let iz = Math.ceil(bounds.minZ / size); iz <= Math.floor(bounds.maxZ / size); iz++) {
      let y = 16;
      for (let layer = 0; layer < 8 && y > -4; layer++) {
        origin.set(ix * size, y, iz * size);
        const hit = physics.ray(origin, down, y + 4); if (!hit) break;
        const floor = y - hit.toi; y = floor - .15;
        if (hit.normal.y < .75) continue;
        const point = new Vector3(ix * size, floor + .06, iz * size);
        if (!clear(point) || !support(point)) continue;
        origin.copy(point); origin.y += p.height + .05;
        const outdoor = point.y >= -.1 && point.y < 1 && !physics.ray(origin, up, 35);
        const cell = { id: cells.length, ix, iz, point, outdoor };
        cells.push(cell); const key = `${ix}:${iz}`;
        if (!columns.has(key)) columns.set(key, []); columns.get(key)!.push(cell);
      }
    }
  }
  const connected = (a: Cell, b: Cell): boolean => {
    if (Math.abs(a.point.y - b.point.y) > size * Math.tan(p.maxSlope * Math.PI / 180) + p.stepHeight) return false;
    const steps = Math.abs(a.point.y - b.point.y) > .25 ? 4 : 1;
    let previous = a.point;
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      let next = b.point;
      if (steps > 1) {
        origin.lerpVectors(a.point, b.point, t); origin.y = previous.y + p.stepHeight + .12;
        const floor = physics.ray(origin, down, p.stepHeight * 2 + .3);
        if (!floor || floor.normal.y < .75) return false;
        next = new Vector3(origin.x, origin.y - floor.toi + .06, origin.z);
        if (Math.abs(next.y - previous.y) > p.stepHeight + .03 || !clear(next)) return false;
      }
      center.copy(previous); center.y = Math.max(previous.y, next.y) + p.height / 2 + .02;
      velocity.subVectors(next, previous); velocity.y = 0;
      const obstacle = physics.world.castShape(center, identityRotation, velocity, shape, 1, false, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
      if (obstacle && obstacle.toi < .999) return false;
      previous = next;
    }
    return true;
  };
  const visited = new Set<number>(), groups: Cell[][] = [], cache = new Map<string, boolean>();
  for (const start of cells) {
    if (visited.has(start.id)) continue;
    const group = [start]; visited.add(start.id);
    for (let index = 0; index < group.length; index++) {
      const cell = group[index];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (const next of columns.get(`${cell.ix + dx}:${cell.iz + dz}`) ?? []) {
          if (visited.has(next.id)) continue;
          const key = `${Math.min(cell.id, next.id)}:${Math.max(cell.id, next.id)}`;
          let pass = cache.get(key);
          if (pass === undefined) { pass = connected(cell, next); cache.set(key, pass); }
          if (pass) { visited.add(next.id); group.push(next); }
        }
      }
    }
    groups.push(group);
  }
  const ranked = groups.map(group => {
    const outdoor = group.filter(cell => cell.outdoor);
    const zones = p.spawnZones.filter(zone => outdoor.some(cell => Math.hypot(zone.x - cell.point.x, zone.z - cell.point.z) < 5)).length;
    return { group, outdoor, zones };
  }).sort((a, b) => b.zones - a.zones || b.outdoor.length - a.outdoor.length);
  const chosen = ranked.find(component => component.outdoor.length > 80 && component.group.length * size * size > 150);
  if (!chosen) throw new Error('No connected outdoor combat area could be validated for spawning.');
  const candidates = chosen.outdoor.map(cell => cell.point);
  candidates.sort((a, b) => Math.hypot(a.x - p.spawn.x, a.z - p.spawn.z) - Math.hypot(b.x - p.spawn.x, b.z - p.spawn.z));
  const points: Vector3[] = [];
  for (const zone of [p.spawn, ...p.spawnZones]) {
    const local = [...candidates].sort((a, b) => Math.hypot(a.x - zone.x, a.z - zone.z) - Math.hypot(b.x - zone.x, b.z - zone.z));
    let count = 0;
    for (const point of local) {
      if (points.some(existing => existing.distanceTo(point) < 1.25)) continue;
      points.push(point); if (++count >= 6) break;
    }
  }
  if (points.length < 30) throw new Error('Not enough connected outdoor spawn points.');
  return { version: 1, cellSize: size, connectedCells: chosen.group.length, zoneCoverage: chosen.zones,
    hub: points[0].toArray(), points: points.map(point => point.toArray()),
    components: ranked.map(component => ({ cells: component.group.length, outdoor: component.outdoor.length, zones: component.zones })) };
}

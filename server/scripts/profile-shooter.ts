import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ShooterWorld } from '../src/simulation/ShooterWorld';

const { values } = parseArgs({ options: { output: { type: 'string' } } });
const worlds: ShooterWorld[] = [], stages = [];
const memory = () => Object.fromEntries(Object.entries(process.memoryUsage()).map(([key, value]) => [key, Math.round(value / 1048576 * 100) / 100]));
const baselineMiB = memory();
try {
  for (let room = 0; room < 3; room++) {
    const started = performance.now(), world = await ShooterWorld.create(); worlds.push(world);
    const loadMs = performance.now() - started;
    for (let player = 0; player < 15; player++) {
      const id = String(player); world.add(id, player);
      world.input(id, { seq: 1, life: 1, f: .3, r: .2, y: player * .4, p: 0, s: false, c: false, j: false, a: false, active: true });
    }
    for (let step = 0; step < 30; step++) for (const active of worlds) active.step(() => false);
    const samples = [];
    for (let step = 0; step < 120; step++) {
      const start = performance.now();
      for (const active of worlds) active.step(() => false);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const stage = { rooms: worlds.length, players: worlds.length * 15, loadMs: Math.round(loadMs * 100) / 100,
      allRoomStepMeanMs: samples.reduce((a, b) => a + b, 0) / samples.length,
      allRoomStepP95Ms: samples[Math.ceil(samples.length * .95) - 1], memoryMiB: memory() };
    stages.push(stage); console.log(JSON.stringify(stage));
  }
} finally { for (const world of worlds) world.dispose(); }
const report = { baselineMiB, stages, note: 'Local in-process physics microbenchmark, 15 players per room; excludes rendering, network and voice.' };
if (values.output) {
  await mkdir(new URL('../../.local/', import.meta.url), { recursive: true });
  await writeFile(values.output, JSON.stringify(report, null, 2) + '\n');
}

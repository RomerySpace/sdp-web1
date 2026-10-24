import { createHash, timingSafeEqual } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';

export interface SimulationReading {
  id: string;
  mode: 'limbo' | 'shooter';
  tick: number;
  online: number;
  players: number;
  targetHz: number;
}

const round = (value: number) => Math.round(value * 100) / 100;

export class SimulationSampler {
  private previous = new Map<string, { tick: number; at: number; online: number }>();
  sample(rooms: readonly SimulationReading[], now: number) {
    const next = new Map<string, { tick: number; at: number; online: number }>();
    const modes = (['limbo', 'shooter'] as const).map(mode => {
      const selected = rooms.filter(room => room.mode === mode);
      const rates: number[] = [];
      let slowRooms = 0;
      for (const room of selected) {
        const before = this.previous.get(room.id);
        next.set(room.id, { tick: room.tick, at: now, online: room.online });
        // Ignore a room's first/empty interval rather than reporting a false slowdown.
        if (!before || now <= before.at || !before.online || !room.online) continue;
        const hz = ((room.tick - before.tick) >>> 0) * 1000 / (now - before.at);
        rates.push(hz);
        if (hz < room.targetHz * .9) slowRooms++;
      }
      return [mode, { rooms: selected.length, online: selected.reduce((sum, room) => sum + room.online, 0),
        reservedPlayers: selected.reduce((sum, room) => sum + Math.max(0, room.players - room.online), 0),
        measuredRooms: rates.length, simulationHzMin: rates.length ? round(Math.min(...rates)) : null,
        simulationHzMean: rates.length ? round(rates.reduce((sum, hz) => sum + hz, 0) / rates.length) : null, slowRooms }] as const;
    });
    this.previous = next;
    return Object.fromEntries(modes);
  }
}

export function diagnosticsAuthorization(token = process.env.SDP_DIAGNOSTICS_TOKEN): (header: string | undefined) => boolean {
  if (!token) return () => false;
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error('SDP_DIAGNOSTICS_TOKEN must be 32-128 URL-safe characters.');
  const expected = createHash('sha256').update(`Bearer ${token}`).digest();
  return header => typeof header === 'string' && header.length <= 256 &&
    timingSafeEqual(expected, createHash('sha256').update(header).digest());
}

export class RuntimeDiagnostics {
  private readonly histogram = monitorEventLoopDelay({ resolution: 20 });
  private readonly sampler = new SimulationSampler();
  private cpu = process.cpuUsage();
  private at = performance.now();
  private lastLog = this.at;
  private latest: object | undefined;
  private sampledAt = 0;
  private pending?: Promise<void>;
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly metadata: { region: string; revision: string },
    private readonly rooms: () => Promise<SimulationReading[]>, private readonly admission: () => object) {
    this.histogram.enable();
    this.timer = setInterval(() => { void this.sample().catch(() => console.error('[SDP] Runtime diagnostics sample unavailable')); }, 5000);
    this.timer.unref();
  }
  sample(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = this.collect().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async collect(): Promise<void> {
    const rooms = await this.rooms(), now = performance.now(), cpu = process.cpuUsage(), memory = process.memoryUsage();
    const elapsed = now - this.at;
    this.latest = { ...this.metadata, sampledAt: new Date().toISOString(), uptimeSeconds: Math.floor(process.uptime()),
      windowSeconds: round(elapsed / 1000), cpuPercentOneCore: elapsed > 0 ? round((cpu.user + cpu.system - this.cpu.user - this.cpu.system) / (elapsed * 10)) : 0,
      memoryMiB: { rss: round(memory.rss / 1024 ** 2), heapUsed: round(memory.heapUsed / 1024 ** 2), external: round(memory.external / 1024 ** 2) },
      eventLoopMs: { p95: round(this.histogram.percentile(95) / 1e6), max: round(this.histogram.max / 1e6), resolution: 20 },
      admission: this.admission(), modes: this.sampler.sample(rooms, now) };
    this.at = now; this.cpu = cpu; this.sampledAt = now; this.histogram.reset();
    if (now - this.lastLog >= 30000) {
      console.log('[SDP] Runtime', JSON.stringify(this.latest)); this.lastLog = now;
    }
  }
  read() { return { status: this.latest ? 'available' : 'warming-up', sampleAgeSeconds: this.sampledAt ? round((performance.now() - this.sampledAt) / 1000) : null, sample: this.latest ?? null }; }
  dispose(): void { clearInterval(this.timer); this.histogram.disable(); }
}

import { MathUtils } from 'three';
import { shooterNetworkConfig } from '../../../../shared/ShooterProtocol';
import { gameConfig } from '../config/gameConfig';

export interface MotionSample { time: number; x: number; y: number; z: number; yaw: number; pitch: number; height: number; lean?: number; gaitPhase?: number; gaitX?: number; gaitZ?: number }
export class SnapshotClock {
  private offset?: number;
  private previous?: { server: number; received: number };
  private renderedTime = -Infinity;
  jitterMs = 0;
  maxGapMs = 0;
  reset(): void { this.offset = undefined; this.previous = undefined; this.renderedTime = -Infinity; this.jitterMs = this.maxGapMs = 0; }
  receive(server: number, received: number): void {
    const candidate = server - received;
    this.offset = this.offset === undefined ? candidate : Math.max(this.offset, candidate);
    if (this.previous) {
      const gap = received - this.previous.received;
      this.maxGapMs = Math.max(this.maxGapMs, gap);
      this.jitterMs += (Math.abs(gap - (server - this.previous.server)) - this.jitterMs) * .1;
    }
    this.previous = { server, received };
  }
  get interpolationMs(): number {
    return MathUtils.clamp(shooterNetworkConfig.interpolationMs + this.jitterMs * 2,
      shooterNetworkConfig.interpolationMs, shooterNetworkConfig.maxInterpolationMs);
  }
  serverNow(now: number): number { return now + (this.offset ?? 0); }
  renderTime(now: number): number {
    this.renderedTime = Math.max(this.renderedTime, this.serverNow(now) - this.interpolationMs);
    return this.renderedTime;
  }
}
export class MotionBuffer {
  private readonly samples: MotionSample[] = [];
  clear(): void { this.samples.length = 0; }
  push(sample: MotionSample): void {
    if (this.samples.length && sample.time <= this.samples[this.samples.length - 1].time) return;
    this.samples.push(sample);
    if (this.samples.length > 32) this.samples.shift();
  }
  sample(time: number): MotionSample | undefined {
    if (!this.samples.length) return;
    while (this.samples.length > 2 && this.samples[1].time < time) this.samples.shift();
    const before = this.samples[0], after = this.samples[1] ?? before;
    if (time <= before.time) return { ...before };
    const dt = after.time - before.time;
    const newest = this.samples[this.samples.length - 1];
    if (time > newest.time && this.samples.length > 1) {
      const previous = this.samples[this.samples.length - 2], seconds = (newest.time - previous.time) / 1000;
      const ahead = Math.min(time - newest.time, shooterNetworkConfig.extrapolationMs) / 1000;
      if (seconds <= 0) return { ...newest };
      let vx = (newest.x - previous.x) / seconds, vz = (newest.z - previous.z) / seconds;
      const speed = Math.hypot(vx, vz), maximum = gameConfig.player.sprintSpeed * 1.1;
      if (speed > maximum) { vx *= maximum / speed; vz *= maximum / speed; }
      const vy = MathUtils.clamp((newest.y - previous.y) / seconds, -12, 8);
      return { ...newest, x: newest.x + vx * ahead, y: newest.y + vy * ahead, z: newest.z + vz * ahead };
    }
    const t = dt > 0 ? MathUtils.clamp((time - before.time) / dt, 0, 1) : 1;
    return { time, x: MathUtils.lerp(before.x, after.x, t), y: MathUtils.lerp(before.y, after.y, t),
      z: MathUtils.lerp(before.z, after.z, t), pitch: MathUtils.lerp(before.pitch, after.pitch, t),
      height: MathUtils.lerp(before.height, after.height, t),
      lean: MathUtils.lerp(before.lean ?? 0, after.lean ?? 0, t),
      gaitPhase: MathUtils.lerp(before.gaitPhase ?? 0, after.gaitPhase ?? 0, t),
      gaitX: MathUtils.lerp(before.gaitX ?? 0, after.gaitX ?? 0, t),
      gaitZ: MathUtils.lerp(before.gaitZ ?? 0, after.gaitZ ?? 0, t),
      yaw: before.yaw + Math.atan2(Math.sin(after.yaw - before.yaw), Math.cos(after.yaw - before.yaw)) * t };
  }
}

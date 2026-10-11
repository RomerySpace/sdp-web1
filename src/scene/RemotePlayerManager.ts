import { BoxGeometry, CapsuleGeometry, Group, Mesh, MeshStandardMaterial, type Scene } from 'three';
import type { LobbySnapshot } from '../../shared/MultiplayerProtocol';
import type { Atmosphere } from './Atmosphere';

interface Sample { time: number; x: number; y: number; z: number; yaw: number; pitch: number }
interface RemoteVisitor { group: Group; marker: Mesh; samples: Sample[] }
const INTERPOLATION_DELAY_MS = 100;

export class RemotePlayerManager {
  readonly group = new Group();
  private readonly visitors = new Map<string, RemoteVisitor>();
  private readonly body = new CapsuleGeometry(0.23, 1.1, 4, 8);
  private readonly markerGeometry = new BoxGeometry(0.07, 0.045, 0.1);
  private readonly material = new MeshStandardMaterial({
    color: 0xc6cfd3, roughness: 0.94, metalness: 0,
    transparent: true, opacity: 0.68, depthWrite: false,
  });

  constructor(scene: Scene, atmosphere: Atmosphere) {
    this.group.name = 'Remote visitors';
    atmosphere.apply(this.material);
    scene.add(this.group);
  }

  get count(): number { return this.visitors.size; }

  receive(snapshot: LobbySnapshot): void {
    const present = new Set<string>();
    for (const player of snapshot.players) {
      if (!player.connected || player.playerId === snapshot.localPlayerId) continue;
      present.add(player.playerId);
      let visitor = this.visitors.get(player.playerId);
      if (!visitor) {
        const group = new Group();
        group.name = `Visitor:${player.playerId}`;
        const body = new Mesh(this.body, this.material);
        body.position.y = 0.8;
        const marker = new Mesh(this.markerGeometry, this.material);
        marker.position.set(0, 1.48, -0.22);
        group.add(body, marker);
        group.position.set(player.x, player.y - 1.7, player.z);
        group.rotation.y = player.yaw;
        visitor = { group, marker, samples: [] };
        this.visitors.set(player.playerId, visitor);
        this.group.add(group);
      }
      visitor.samples.push({ time: snapshot.receivedAt, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch });
      if (visitor.samples.length > 8) visitor.samples.shift();
    }
    for (const [id, visitor] of this.visitors) {
      if (!present.has(id)) { visitor.group.removeFromParent(); visitor.group.clear(); this.visitors.delete(id); }
    }
  }

  update(now: number, reveal: number): void {
    this.group.visible = reveal >= 0.999;
    const renderTime = now - INTERPOLATION_DELAY_MS;
    for (const visitor of this.visitors.values()) {
      const samples = visitor.samples;
      if (!samples.length) continue;
      let before = samples[0], after = samples[samples.length - 1];
      for (let i = 1; i < samples.length; i++) {
        if (samples[i].time >= renderTime) { before = samples[i - 1]; after = samples[i]; break; }
        before = samples[i];
      }
      const t = after.time > before.time ? Math.max(0, Math.min(1, (renderTime - before.time) / (after.time - before.time))) : 1;
      visitor.group.position.set(
        before.x + (after.x - before.x) * t,
        before.y + (after.y - before.y) * t - 1.7,
        before.z + (after.z - before.z) * t,
      );
      const angle = Math.atan2(Math.sin(after.yaw - before.yaw), Math.cos(after.yaw - before.yaw));
      visitor.group.rotation.y = before.yaw + angle * t;
      const pitch = before.pitch + (after.pitch - before.pitch) * t;
      visitor.marker.position.y = 1.48 + Math.sin(pitch) * 0.08;
    }
  }

  dispose(): void {
    for (const visitor of this.visitors.values()) { visitor.group.removeFromParent(); visitor.group.clear(); }
    this.visitors.clear();
    this.group.removeFromParent();
    this.body.dispose(); this.markerGeometry.dispose(); this.material.dispose();
  }
}

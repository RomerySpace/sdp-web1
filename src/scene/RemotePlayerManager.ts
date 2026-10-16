import { BoxGeometry, CapsuleGeometry, Group, Mesh, MeshStandardMaterial, type Scene } from 'three';
import type { LobbySnapshot } from '../../shared/MultiplayerProtocol';
import type { Atmosphere } from './Atmosphere';
import { lobbyAmbience } from '../core/LobbyAmbience';

interface Sample { time: number; x: number; y: number; z: number; yaw: number; pitch: number; crouching: boolean }
interface RemoteVisitor { group: Group; marker: Mesh; material: MeshStandardMaterial; samples: Sample[] }
const INTERPOLATION_DELAY_MS = 100;

export class RemotePlayerManager {
  readonly group = new Group();
  private readonly visitors = new Map<string, RemoteVisitor>();
  private voiceLevels: ReadonlyMap<string, number> = new Map();
  private lastUpdate = 0;
  private readonly body = new CapsuleGeometry(0.23, 1.1, 4, 8);
  private readonly markerGeometry = new BoxGeometry(0.07, 0.045, 0.1);
  private readonly material = new MeshStandardMaterial({
    color: 0xc6cfd3, roughness: 0.94, metalness: 0,
    transparent: true, opacity: 0.68, depthWrite: false,
  });

  constructor(scene: Scene, private readonly atmosphere: Atmosphere) {
    this.group.name = 'Remote visitors';
    atmosphere.apply(this.material);
    scene.add(this.group);
  }

  get count(): number { return this.visitors.size; }
  setVoiceLevels(levels: ReadonlyMap<string, number>): void { this.voiceLevels = levels; }

  receive(snapshot: LobbySnapshot): void {
    const present = new Set<string>();
    for (const player of snapshot.players) {
      if (!player.connected || player.playerId === snapshot.localPlayerId) continue;
      present.add(player.playerId);
      let visitor = this.visitors.get(player.playerId);
      if (!visitor) {
        const group = new Group();
        group.name = `Visitor:${player.playerId}`;
        const material = this.material.clone(); this.atmosphere.apply(material);
        const body = new Mesh(this.body, material);
        body.position.y = 0.8;
        const marker = new Mesh(this.markerGeometry, material);
        marker.position.set(0, 1.48, -0.22);
        group.add(body, marker);
        group.position.set(player.x, player.y - 1.7, player.z);
        group.rotation.y = player.yaw;
        visitor = { group, marker, material, samples: [] };
        this.visitors.set(player.playerId, visitor);
        this.group.add(group);
      }
      visitor.samples.push({ time: snapshot.receivedAt, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, crouching: Boolean(player.crouching) });
      if (visitor.samples.length > 8) visitor.samples.shift();
    }
    for (const [id, visitor] of this.visitors) {
      if (!present.has(id)) { visitor.group.removeFromParent(); visitor.group.clear(); visitor.material.dispose(); this.visitors.delete(id); }
    }
  }

  update(now: number, reveal: number): void {
    this.group.visible = reveal >= 0.999;
    const renderTime = now - INTERPOLATION_DELAY_MS;
    const dt = this.lastUpdate ? Math.min(.1, (now - this.lastUpdate) / 1000) : 0;
    this.lastUpdate = now;
    for (const [id, visitor] of this.visitors) {
      const settings = lobbyAmbience.voice;
      const opacity = settings.silentOpacity + (settings.speakingOpacity - settings.silentOpacity) * (this.voiceLevels.get(id) ?? 0);
      const speed = opacity > visitor.material.opacity ? 18 : 8;
      visitor.material.opacity += (opacity - visitor.material.opacity) * (1 - Math.exp(-dt * speed));
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
      visitor.group.scale.y = (before.crouching ? .65 : 1) + ((after.crouching ? .65 : 1) - (before.crouching ? .65 : 1)) * t;
      const pitch = before.pitch + (after.pitch - before.pitch) * t;
      visitor.marker.position.y = 1.48 + Math.sin(pitch) * 0.08;
    }
  }

  dispose(): void {
    for (const visitor of this.visitors.values()) { visitor.group.removeFromParent(); visitor.group.clear(); visitor.material.dispose(); }
    this.visitors.clear();
    this.group.removeFromParent();
    this.body.dispose(); this.markerGeometry.dispose(); this.material.dispose();
  }
}

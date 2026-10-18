import { AdditiveBlending, BackSide, BoxGeometry, CapsuleGeometry, Group, MathUtils, Mesh, MeshStandardMaterial, Raycaster, ShaderMaterial, Sphere, Vector2, Vector3, type Camera, type Object3D, type Scene } from 'three';
import type { LobbySnapshot } from '../../shared/MultiplayerProtocol';
import { PLAYER_HEIGHT } from '../../shared/MultiplayerProtocol';
import type { Atmosphere } from './Atmosphere';
import { lobbyAmbience } from '../core/LobbyAmbience';
import { lobbyRetreat, lobbySeatSlots } from '../../shared/LobbyRetreat';

interface Sample { time: number; x: number; y: number; z: number; yaw: number; pitch: number; crouching: boolean; seat: number }
interface RemoteVisitor { group: Group; body: Mesh; legs: Group; posture: number; name: string; marker: Mesh; material: MeshStandardMaterial; halo: Mesh<CapsuleGeometry, ShaderMaterial>; level: number; samples: Sample[] }
const INTERPOLATION_DELAY_MS = 100;

export class RemotePlayerManager {
  readonly group = new Group();
  private readonly visitors = new Map<string, RemoteVisitor>();
  private voiceLevels: ReadonlyMap<string, number> = new Map();
  private lastUpdate = 0;
  private readonly raycaster = new Raycaster();
  private readonly center = new Vector2();
  private readonly head = new Sphere(new Vector3(), .28);
  private readonly hit = new Vector3();
  private readonly body = new CapsuleGeometry(0.23, 1.1, 4, 8);
  private readonly legGeometry = new CapsuleGeometry(.085, .24, 3, 6);
  private readonly markerGeometry = new BoxGeometry(0.07, 0.045, 0.1);
  private readonly material = new MeshStandardMaterial({
    color: 0xc6cfd3, roughness: 0.94, metalness: 0,
    transparent: true, opacity: 0.68, depthWrite: false, emissive: 0xdcefff, emissiveIntensity: 0,
  });
  private readonly haloMaterial = new ShaderMaterial({
    transparent: true, blending: AdditiveBlending, depthWrite: false, side: BackSide, toneMapped: false,
    uniforms: { strength: { value: 0 } },
    vertexShader: `varying vec3 vNormal; varying vec3 vView;
      void main() { vec4 view = modelViewMatrix * vec4(position, 1.0); vNormal = normalize(normalMatrix * normal); vView = -view.xyz;
        gl_Position = projectionMatrix * view; }`,
    fragmentShader: `uniform float strength; varying vec3 vNormal; varying vec3 vView;
      void main() { float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 1.8);
        float fog = exp(-dot(vView, vView) * .0012);
        gl_FragColor = vec4(.72, .88, 1.0, rim * fog * strength); }`,
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
        const halo = new Mesh(this.body, this.haloMaterial.clone());
        halo.name = 'Voice glow'; halo.position.y = .8; halo.scale.set(1.18, 1.08, 1.18); halo.visible = false;
        const legs = new Group(); legs.name = 'Seated legs'; legs.visible = false;
        for (const x of [-.13, .13]) {
          const thigh = new Mesh(this.legGeometry, material); thigh.position.set(x, .46, -.18); thigh.rotation.x = Math.PI / 2;
          const shin = new Mesh(this.legGeometry, material); shin.position.set(x, .22, -.38); legs.add(thigh, shin);
        }
        group.add(body, marker, halo, legs);
        group.position.set(player.x, player.y - PLAYER_HEIGHT, player.z);
        group.rotation.y = player.yaw;
        visitor = { group, body, legs, posture: 0, name: '', marker, material, halo, level: 0, samples: [] };
        this.visitors.set(player.playerId, visitor);
        this.group.add(group);
      }
      visitor.name = player.displayName || 'VISITOR';
      visitor.samples.push({ time: snapshot.receivedAt, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch, crouching: Boolean(player.crouching), seat: player.seatIndex ?? -1 });
      if (visitor.samples.length > 8) visitor.samples.shift();
    }
    for (const [id, visitor] of this.visitors) {
      if (!present.has(id)) { visitor.group.removeFromParent(); visitor.group.clear(); visitor.material.dispose(); visitor.halo.material.dispose(); this.visitors.delete(id); }
    }
  }

  focus(camera: Camera, occluders: Object3D[] = []): { id: string; name: string } | undefined {
    if (!this.group.visible) return;
    this.raycaster.setFromCamera(this.center, camera); this.raycaster.far = lobbyAmbience.identity.distance;
    let nearest = this.raycaster.far, focused: { id: string; name: string } | undefined;
    for (const [id, visitor] of this.visitors) {
      const intersection = this.raycaster.intersectObject(visitor.body, false)[0];
      let distance = intersection?.distance ?? Infinity;
      this.head.center.set(0, visitor.marker.position.y, 0).applyMatrix4(visitor.group.matrixWorld);
      this.head.radius = .28;
      if (this.raycaster.ray.intersectSphere(this.head, this.hit)) distance = Math.min(distance, this.hit.distanceTo(this.raycaster.ray.origin));
      if (distance < nearest) { nearest = distance; focused = { id, name: visitor.name }; }
    }
    if (focused && this.raycaster.intersectObjects(occluders, true).some(hit => hit.distance < nearest - .03)) return;
    return focused;
  }

  update(now: number, reveal: number): void {
    this.group.visible = reveal >= 0.999;
    const renderTime = now - INTERPOLATION_DELAY_MS;
    const dt = this.lastUpdate ? Math.min(.1, (now - this.lastUpdate) / 1000) : 0;
    this.lastUpdate = now;
    for (const [id, visitor] of this.visitors) {
      const settings = lobbyAmbience.voice;
      const level = Math.max(0, Math.min(1, this.voiceLevels.get(id) ?? 0));
      visitor.level += (level - visitor.level) * (1 - Math.exp(-dt * (level > visitor.level ? 18 : 8)));
      visitor.material.opacity = settings.silentOpacity + (settings.speakingOpacity - settings.silentOpacity) * visitor.level;
      visitor.material.emissiveIntensity = settings.glowIntensity * visitor.level;
      visitor.halo.material.uniforms.strength.value = settings.haloOpacity * visitor.level;
      visitor.halo.visible = visitor.level > .015;
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
        (before.y - (before.seat >= 0 ? lobbyRetreat.seatedEye : PLAYER_HEIGHT)) * (1 - t) + (after.y - (after.seat >= 0 ? lobbyRetreat.seatedEye : PLAYER_HEIGHT)) * t,
        before.z + (after.z - before.z) * t,
      );
      const angle = Math.atan2(Math.sin(after.yaw - before.yaw), Math.cos(after.yaw - before.yaw));
      visitor.group.rotation.y = before.yaw + angle * t;
      // The torso follows the gaze; only seated legs stay anchored to the bench.
      visitor.legs.rotation.y = after.seat >= 0 ? lobbySeatSlots[after.seat].yaw - visitor.group.rotation.y : 0;
      visitor.group.scale.y = (before.crouching ? .65 : 1) + ((after.crouching ? .65 : 1) - (before.crouching ? .65 : 1)) * t;
      visitor.posture = MathUtils.damp(visitor.posture, after.seat >= 0 ? 1 : 0, 12, dt);
      visitor.body.scale.y = 1 - visitor.posture * .4;
      visitor.body.position.y = .8 + visitor.posture * .11;
      visitor.legs.visible = visitor.posture > .05; visitor.legs.scale.setScalar(visitor.posture);
      visitor.halo.position.y = visitor.body.position.y; visitor.halo.scale.y = 1.08 * visitor.body.scale.y;
      const pitch = before.pitch + (after.pitch - before.pitch) * t;
      visitor.marker.position.y = 1.48 - visitor.posture * .23 + Math.sin(pitch) * 0.08;
      visitor.marker.rotation.y = 0;
    }
  }

  dispose(): void {
    for (const visitor of this.visitors.values()) { visitor.group.removeFromParent(); visitor.group.clear(); visitor.material.dispose(); visitor.halo.material.dispose(); }
    this.visitors.clear();
    this.group.removeFromParent();
    this.body.dispose(); this.legGeometry.dispose(); this.markerGeometry.dispose(); this.material.dispose(); this.haloMaterial.dispose();
  }
}

import { SpotLight, Vector3, type Camera, type Scene, type WebGLRenderer } from 'three';
import { gameplayConfig } from '../../../../shared/GameplayConfig';
import type { LobbySnapshot } from '../../../../shared/MultiplayerProtocol';

export class Flashlights {
  readonly local: SpotLight;
  private readonly remotes: SpotLight[];
  private readonly position = new Vector3();
  private readonly direction = new Vector3();
  private readonly remotePosition = new Vector3();
  private readonly remoteTarget = new Vector3();
  private previousTime = performance.now();
  constructor(private readonly scene: Scene, private readonly renderer: WebGLRenderer) {
    this.local = this.create(512);
    this.remotes = Array.from({ length: gameplayConfig.flashlight.remoteLights }, () => this.create(256));
  }
  private create(resolution: number): SpotLight {
    const c = gameplayConfig.flashlight;
    const light = new SpotLight(0xf2f6ff, 0, c.range, c.angle, c.penumbra, 2);
    light.castShadow = true; light.shadow.mapSize.setScalar(resolution);
    light.shadow.autoUpdate = false;
    light.shadow.camera.near = .08; light.shadow.camera.far = c.range;
    light.shadow.bias = -.00015; light.shadow.normalBias = .025;
    light.layers.enable(1); light.shadow.camera.layers.set(0);
    this.scene.add(light, light.target); return light;
  }
  update(camera: Camera, enabled: boolean, snapshot?: LobbySnapshot): void {
    const now = performance.now(), blend = 1 - Math.exp(-22 * Math.min(.05, (now - this.previousTime) / 1000)); this.previousTime = now;
    camera.getWorldPosition(this.position); camera.getWorldDirection(this.direction);
    this.local.position.copy(this.position).addScaledVector(this.direction, .25);
    this.local.target.position.copy(this.position).addScaledVector(this.direction, gameplayConfig.flashlight.range);
    this.local.intensity = enabled ? gameplayConfig.flashlight.intensity : 0;
    this.local.shadow.needsUpdate = enabled;
    const nearby = (snapshot?.players ?? []).filter(p => p.playerId !== snapshot?.localPlayerId && p.connected && !p.dead && p.flashlight && this.position.distanceToSquared(p) < (gameplayConfig.flashlight.range + 16) ** 2)
      .sort((a, b) => this.position.distanceToSquared(a) - this.position.distanceToSquared(b));
    this.remotes.forEach((light, index) => {
      const player = nearby[index]; light.intensity = player ? gameplayConfig.flashlight.intensity : 0;
      light.shadow.needsUpdate = !!player;
      if (!player) return;
      this.remotePosition.set(player.x, player.y + (player.height ?? 1.8) - .18, player.z);
      this.direction.set(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
      this.remotePosition.addScaledVector(this.direction, .28);
      this.remoteTarget.copy(this.remotePosition).addScaledVector(this.direction, gameplayConfig.flashlight.range);
      const response = light.userData.ownerId === player.playerId ? blend : 1;
      light.position.lerp(this.remotePosition, response); light.target.position.lerp(this.remoteTarget, response);
      light.userData.ownerId = player.playerId;
    });
    if (enabled || nearby.length) this.renderer.shadowMap.needsUpdate = true;
  }
  dispose(): void { for (const light of [this.local, ...this.remotes]) { light.shadow.dispose(); light.dispose(); light.removeFromParent(); light.target.removeFromParent(); } }
}

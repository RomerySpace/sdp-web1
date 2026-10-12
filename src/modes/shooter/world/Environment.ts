import { Color, DirectionalLight, FogExp2, HemisphereLight, PMREMGenerator, Vector3 } from 'three';
import type { Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { gameConfig } from '../config/gameConfig';

export class Environment {
  readonly key = new DirectionalLight('#fff9f0', gameConfig.environment.keyIntensity);
  private readonly fill = new HemisphereLight('#e6f2ff', '#b3b6b9', gameConfig.environment.fillIntensity);
  private target = new Vector3(1e6, 1e6, 1e6);
  private environment?: WebGLRenderTarget;
  private disposed = false;
  hdrLoaded = false;
  constructor(private readonly scene: Scene, private readonly renderer: WebGLRenderer) {
    const e = gameConfig.environment;
    scene.background = new Color(e.background);
    scene.fog = new FogExp2(e.fogColor, e.fogDensity);
    this.key.castShadow = true;
    this.key.shadow.mapSize.setScalar(e.shadowResolution);
    this.key.shadow.camera.near = 1; this.key.shadow.camera.far = 120;
    this.key.shadow.bias = -0.00015;
    this.key.shadow.normalBias = 0.035;
    this.key.shadow.radius = 4;
    scene.add(this.key, this.key.target, this.fill);
    this.follow(new Vector3(15, 0, 5));
    this.update();
  }
  async load(): Promise<void> {
    const exr = await new EXRLoader().loadAsync(gameConfig.assets.hdr);
    if (this.disposed) { exr.dispose(); return; }
    const pmrem = new PMREMGenerator(this.renderer);
    this.environment = pmrem.fromEquirectangular(exr);
    this.scene.environment = this.environment.texture;
    exr.dispose(); pmrem.dispose(); this.hdrLoaded = true;
  }
  update(): void {
    const e = gameConfig.environment;
    (this.scene.fog as FogExp2).density = e.fogDensity;
    (this.scene.fog as FogExp2).color.set(e.fogColor);
    this.scene.environmentIntensity = e.hdrIntensity;
    this.renderer.toneMappingExposure = e.exposure;
    this.key.intensity = e.keyIntensity;
    this.key.shadow.intensity = e.shadowIntensity;
    this.fill.intensity = e.fillIntensity;
    const c = this.key.shadow.camera, r = e.shadowRadius;
    c.left = c.bottom = -r; c.right = c.top = r; c.updateProjectionMatrix();
  }
  follow(position: Vector3): void {
    // Shadow frustum tracks the player in metre increments; the whole map needn't be redrawn every frame.
    const x = Math.floor(position.x), z = Math.floor(position.z);
    if (Math.abs(this.target.x - x) + Math.abs(this.target.z - z) < 2) return;
    this.target.set(x, position.y, z);
    this.key.target.position.copy(this.target);
    this.key.position.copy(this.target).add(new Vector3(-24, 45, 18));
    this.renderer.shadowMap.needsUpdate = true;
  }
  dispose(): void { this.disposed = true; this.environment?.dispose(); this.key.shadow.dispose(); }
}

import {
  DirectionalLight, EquirectangularReflectionMapping, HemisphereLight,
  PMREMGenerator, SpotLight, type Scene, type WebGLRenderer, type WebGLRenderTarget,
} from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

export class Lighting {
  private environment: WebGLRenderTarget | undefined;
  private disposed = false;
  private readonly key: DirectionalLight;

  constructor(private readonly scene: Scene) {
    scene.add(new HemisphereLight(0xf1f7fc, 0x9da4ad, 0.4));
    this.key = new DirectionalLight(0xfffcf7, 1.15);
    this.key.position.set(-5, 9, 6);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.left = -5;
    this.key.shadow.camera.right = 5;
    this.key.shadow.camera.top = 5;
    this.key.shadow.camera.bottom = -5;
    this.key.shadow.camera.near = 0.5;
    this.key.shadow.camera.far = 24;
    this.key.shadow.bias = -0.00015;
    this.key.shadow.normalBias = 0.025;
    this.key.shadow.radius = 5;
    this.key.shadow.blurSamples = 8;
    this.key.shadow.intensity = 0.22;
    scene.add(this.key);
    const fill = new DirectionalLight(0xeaf4fa, 0.45);
    fill.position.set(6, 4, -5);
    scene.add(fill);
    const exhibitRim = new SpotLight(0xf0f6fa, 16, 7, Math.PI / 3, 1, 2);
    exhibitRim.position.set(2.5, 3.8, -2.5);
    exhibitRim.target.position.set(0, 1.8, 0);
    scene.add(exhibitRim, exhibitRim.target);
    const exhibitKey = new SpotLight(0xfffcf7, 24, 8, Math.PI / 5, 1, 2);
    exhibitKey.position.set(-2.4, 4.2, 3);
    exhibitKey.target.position.set(0, 1.8, 0);
    scene.add(exhibitKey, exhibitKey.target);
  }

  async loadEnvironment(renderer: WebGLRenderer): Promise<boolean> {
    const pmrem = new PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    try {
      const texture = await new EXRLoader().loadAsync('/hdr/puresky.exr');
      if (this.disposed) { texture.dispose(); return false; }
      texture.mapping = EquirectangularReflectionMapping;
      this.environment = pmrem.fromEquirectangular(texture);
      this.scene.environment = this.environment.texture;
      this.scene.environmentIntensity = 0.38;
      this.scene.environmentRotation.y = 0.6;
      texture.dispose();
      return true;
    } catch (error) {
      console.warn('[SDP] Could not load /hdr/puresky.exr. Using diffuse fallback lighting.', error);
      return false;
    } finally { pmrem.dispose(); }
  }

  dispose(): void {
    this.disposed = true;
    this.scene.environment = null;
    this.environment?.dispose();
    this.key.shadow.dispose();
  }
}

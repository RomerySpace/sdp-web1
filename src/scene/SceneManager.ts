import {
  NeutralToneMapping, PerspectiveCamera, Scene, SRGBColorSpace,
  VSMShadowMap, WebGLRenderer,
} from 'three';
import { Atmosphere } from './Atmosphere';
import { Environment } from './Environment';
import { Lighting } from './Lighting';
import { Sculpture } from './Sculpture';
import { SculptureInspection } from './SculptureInspection';
import { DigitalFragmentManager } from './graphics/DigitalFragmentManager';
import { RemotePlayerManager } from './RemotePlayerManager';

export class SceneManager {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(52, 1, 0.08, 650);
  readonly renderer: WebGLRenderer;
  readonly atmosphere: Atmosphere;
  readonly environment: Environment;
  readonly lighting: Lighting;
  readonly sculpture: Sculpture;
  readonly inspection: SculptureInspection;
  readonly graphics: DigitalFragmentManager;
  readonly remotePlayers: RemotePlayerManager;

  constructor(container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = VSMShadowMap;
    this.renderer.domElement.className = 'scene-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'A solitary rotating sculpture in an infinite white exhibition space');
    container.append(this.renderer.domElement);
    this.atmosphere = new Atmosphere(this.scene);
    this.lighting = new Lighting(this.scene);
    this.environment = new Environment(this.scene, this.atmosphere);
    this.sculpture = new Sculpture(this.scene, this.atmosphere);
    this.inspection = new SculptureInspection(this.renderer.domElement);
    this.graphics = new DigitalFragmentManager(this.scene, this.camera);
    this.remotePlayers = new RemotePlayerManager(this.scene, this.atmosphere);
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('graphicsDebug')) {
      Object.assign(window, { sdpGraphics: this.graphics });
    }
    this.resize();
  }

  resize(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.inspection?.resize();
  }

  render(dt: number, time: number, reveal: number): void {
    this.sculpture.update(dt);
    this.atmosphere.update(time, reveal);
    this.environment.update(reveal);
    this.graphics.update(dt, time, reveal);
    this.remotePlayers.update(performance.now(), reveal);
    if (this.inspection.active) this.inspection.render(this.renderer, this.scene);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.graphics.dispose();
    this.remotePlayers.dispose();
    this.inspection.dispose();
    this.lighting.dispose(); this.environment.dispose(); this.sculpture.dispose(); this.atmosphere.dispose();
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}

import { DoubleSide, Vector2, WebGLRenderTarget } from 'three';
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { gameConfig } from '../config/gameConfig';

/** Half-resolution contact shading applied only to the world pass. */
export class ContactShading {
  private readonly pass: SSAOPass;
  private readonly unusedTarget = new WebGLRenderTarget(1, 1);
  private readonly size = new Vector2();
  private readonly strength = { value: gameConfig.environment.contactStrength };
  constructor(scene: Scene, private readonly camera: PerspectiveCamera) {
    this.pass = new SSAOPass(scene, camera, 512, 512, 16);
    this.pass.renderToScreen = true;
    this.pass.kernelRadius = 0.35;
    this.pass.minDistance = 0.00003;
    this.pass.maxDistance = 0.002;
    this.pass.normalMaterial.side = DoubleSide;
    this.pass.ssaoMaterial.uniforms.contactStrength = this.strength;
    this.pass.ssaoMaterial.fragmentShader = 'uniform float contactStrength;\n' + this.pass.ssaoMaterial.fragmentShader.replace('1.0 - occlusion', '1.0 - occlusion * contactStrength');
  }
  resize(renderer: WebGLRenderer): void {
    renderer.getDrawingBufferSize(this.size);
    this.pass.setSize(Math.max(1, Math.floor(this.size.x * 0.5)), Math.max(1, Math.floor(this.size.y * 0.5)));
  }
  render(renderer: WebGLRenderer): void {
    if (!gameConfig.environment.contactShading) return;
    this.strength.value = gameConfig.environment.contactStrength;
    this.pass.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(this.camera.projectionMatrix);
    this.pass.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(this.camera.projectionMatrixInverse);
    this.pass.render(renderer, this.unusedTarget, this.unusedTarget, 0, false);
    renderer.setRenderTarget(null);
  }
  dispose(): void { this.pass.dispose(); this.unusedTarget.dispose(); }
}

import { Group, LineSegments, Points, type ShaderMaterial, type Vector3 } from 'three';
import { distanceVisibility, smoothstep, type FragmentConfig } from './FragmentConfig';
import type { FragmentAsset } from './FragmentLoader';
import type { FragmentMaterial } from './FragmentMaterial';

export interface FragmentPlacement {
  key: string;
  assetIndex: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  tilt: number;
  scale: number;
  phase: number;
}

export class DigitalFragment {
  readonly object = new Group();
  private readonly lines: LineSegments;
  private readonly points: Points;
  progress = 0;
  opacity = 0;
  distance = Infinity;
  private time = 0;
  private config: FragmentConfig;
  private densityScale = 1;

  constructor(
    readonly asset: FragmentAsset,
    readonly placement: FragmentPlacement,
    materials: FragmentMaterial,
    config: FragmentConfig,
  ) {
    this.config = config;
    this.object.name = `DigitalFragment:${placement.key}:${asset.source}`;
    this.object.position.set(placement.x, placement.y, placement.z);
    this.object.rotation.set(placement.tilt, placement.yaw, 0);
    this.object.scale.setScalar(placement.scale);
    this.lines = new LineSegments(asset.lines, materials.lines);
    this.points = new Points(asset.points, materials.points);
    this.lines.onBeforeRender = (renderer) => this.bind(materials.lines, false, renderer.getPixelRatio());
    this.points.onBeforeRender = (renderer) => this.bind(materials.points, true, renderer.getPixelRatio());
    this.object.add(this.lines, this.points);
    this.object.visible = false;
  }

  private bind(material: ShaderMaterial, points: boolean, pixelRatio: number): void {
    const uniforms = material.uniforms;
    uniforms.uTime.value = this.time;
    uniforms.uProgress.value = this.progress;
    uniforms.uOpacity.value = this.opacity * (points ? 0.82 : 1);
    uniforms.uDepthStrength.value = this.config.depthStrength;
    uniforms.uPhase.value = this.placement.phase;
    uniforms.uDriftSpeed.value = this.config.driftSpeed;
    uniforms.uDensity.value = (points ? this.config.pointDensity : this.config.lineDensity) * this.densityScale;
    uniforms.uPixelRatio.value = pixelRatio;
    // The two materials are shared; each draw needs its fragment's uniforms.
    material.uniformsNeedUpdate = true;
  }

  update(dt: number, time: number, cameraPosition: Vector3, entered: boolean, config: FragmentConfig, densityScale: number): void {
    this.time = time;
    this.config = config;
    this.densityScale = densityScale;
    this.distance = this.object.position.distanceTo(cameraPosition);
    const visibility = entered && config.enabled ? distanceVisibility(this.distance, config) : 0;
    const proximity = 1 - smoothstep(Math.min(4, config.visibilityDistance / 3), config.visibilityDistance * 2 / 3, this.distance);
    const definition = this.distance > 2.8 ? .8 + proximity * .2 : .4 + proximity * .6;
    const targetOpacity = visibility * (config.minimumOpacity + (config.maximumOpacity - config.minimumOpacity) * definition);
    const targetProgress = this.distance > 2.8 && visibility > .001 ? 1 : Math.min(1, visibility * 1.6);
    const step = dt / config.reconstructionDuration;
    this.progress += Math.max(-step, Math.min(step, targetProgress - this.progress));
    this.opacity += (targetOpacity - this.opacity) * (1 - Math.exp(-dt * 4));
    this.object.position.y = this.placement.y + Math.sin(time * config.driftSpeed + this.placement.phase) * 0.025;
    this.object.visible = entered && this.opacity > 0.001 && this.progress > 0.003;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.lines.onBeforeRender = () => {};
    this.points.onBeforeRender = () => {};
    this.object.clear();
  }
}

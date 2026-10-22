import { BoxGeometry, Group, LineSegments, Mesh, MeshBasicMaterial, Points, type BufferGeometry, type Scene } from 'three';
import { captureStudioWalls, inCaptureStudio, temporaryCaptureStudio as config } from '../../shared/TemporaryCaptureStudio';
import { FragmentMaterial } from './graphics/FragmentMaterial';
import type { DigitalFragmentManager } from './graphics/DigitalFragmentManager';

export class TemporaryCaptureStudio {
  readonly group = new Group();
  readonly occluders: Mesh[] = [];
  readonly ready: Promise<void>;
  private readonly black = new MeshBasicMaterial({ color: 0x000000, fog: false, toneMapped: false });
  private readonly materials = new FragmentMaterial();
  private readonly geometry = new BoxGeometry(1, 1, 1);
  private readonly clouds: Group[] = [];
  private readonly particles: BufferGeometry[] = [];
  private time = 0;
  private disposed = false;
  constructor(scene: Scene, graphics: DigitalFragmentManager) {
    this.group.name = 'Temporary black capture studio';
    this.materials.lines.fog = this.materials.points.fog = false;
    if (config.enabled) {
      for (const wall of captureStudioWalls) this.box(wall.x, wall.y, wall.z, wall.width, wall.height, wall.depth);
      this.box(config.x, .015, config.z, config.width, .02, config.depth);
      this.box(config.x, config.height, config.z, config.width, .1, config.depth);
      scene.add(this.group);
    }
    this.ready = config.enabled ? graphics.ready.then(() => this.populate(graphics)) : Promise.resolve();
  }
  private box(x: number, y: number, z: number, width: number, height: number, depth: number): void {
    const mesh = new Mesh(this.geometry, this.black);
    mesh.position.set(x, y, z); mesh.scale.set(width, height, depth);
    mesh.name = 'Capture studio / black shell'; this.group.add(mesh); this.occluders.push(mesh);
  }
  private populate(graphics: DigitalFragmentManager): void {
    if (this.disposed) return;
    for (const [index, asset] of graphics.loadedAssets.slice(0, 3).entries()) {
      const cloud = new Group(); cloud.name = `Capture cloud / ${asset.id}`;
      cloud.position.set(config.x - 5.5, 3.1, config.z + (index - 1) * 4.4);
      cloud.rotation.y = Math.PI / 2; cloud.scale.setScalar(4.2);
      const lines = new LineSegments(this.scatter(asset.lines, true), this.materials.lines), points = new Points(this.scatter(asset.points, false), this.materials.points);
      for (const object of [lines, points]) object.onBeforeRender = renderer => {
        const material = object.material, u = material.uniforms;
        u.uTime.value = this.time; u.uProgress.value = 1;
        u.uOpacity.value = object === points ? .95 : .68;
        u.uAmbientLight.value = 1; u.uDepthStrength.value = .8;
        u.uDensity.value = 1; u.uPhase.value = index * 2.1;
        u.uDriftSpeed.value = .12; u.uPixelRatio.value = renderer.getPixelRatio();
        material.uniformsNeedUpdate = true;
      };
      cloud.add(lines, points); this.clouds.push(cloud); this.group.add(cloud);
    }
  }
  private scatter(source: BufferGeometry, lines: boolean): BufferGeometry {
    const geometry = source.clone(), positions = geometry.getAttribute('position');
    const seeds = geometry.getAttribute('aSeed'), stride = lines ? 2 : 1;
    const random = (seed: number, channel: number) => {
      const value = Math.sin(seed * 17833.13 + channel * 913.73) * 43758.5453;
      return value - Math.floor(value);
    };
    for (let i = 0; i < positions.count; i += stride) {
      const seed = seeds.getX(i), angle = random(seed, 1) * Math.PI * 2, r = Math.sqrt(random(seed, 2));
      const cx = (positions.getX(i) + positions.getX(i + stride - 1)) / 2;
      const cy = (positions.getY(i) + positions.getY(i + stride - 1)) / 2;
      const cz = (positions.getZ(i) + positions.getZ(i + stride - 1)) / 2;
      const y = random(seed, 3) - .5;
      for (let j = i; j < i + stride; j++) positions.setXYZ(j,
        Math.cos(angle) * r * .45 + Math.sin(y * 6) * .1 + (positions.getX(j) - cx) * .65,
        y + (positions.getY(j) - cy) * .65,
        Math.sin(angle) * r * .4 + (positions.getZ(j) - cz) * .65);
    }
    positions.needsUpdate = true; geometry.setDrawRange(0, positions.count); geometry.computeBoundingSphere();
    this.particles.push(geometry); return geometry;
  }
  update(time: number, reveal: number, active: boolean): void {
    this.time = time; this.group.visible = config.enabled && active && reveal > .95;
    for (const [index, cloud] of this.clouds.entries()) {
      cloud.position.y = 3.1 + Math.sin(time * .14 + index * 2.1) * .1;
      cloud.rotation.y = Math.PI / 2 + Math.sin(time * .08 + index) * .07;
    }
  }
  contains(x: number, z: number): boolean { return inCaptureStudio(x, z); }
  dispose(): void {
    this.disposed = true;
    for (const cloud of this.clouds) for (const child of cloud.children) if (child instanceof Points || child instanceof LineSegments) child.onBeforeRender = () => {};
    this.group.removeFromParent(); this.group.clear(); this.clouds.length = 0;
    for (const geometry of this.particles) geometry.dispose(); this.particles.length = 0;
    this.geometry.dispose(); this.black.dispose(); this.materials.dispose();
  }
}

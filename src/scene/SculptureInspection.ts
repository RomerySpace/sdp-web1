import {
  Box3, Color, DirectionalLight, HemisphereLight, MathUtils, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Scene, Sphere, type Group, type WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SCULPTURE_COLOR, type Sculpture } from './Sculpture';

export class SculptureInspection {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(40, 1, 0.02, 100);
  readonly controls: OrbitControls;
  private readonly material = new MeshStandardMaterial({ color: SCULPTURE_COLOR, metalness: 0, roughness: 1, envMapIntensity: 0.25 });
  private model?: Group;
  private radius = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.scene.background = new Color(0xf8fafb);
    const light = new DirectionalLight(0xffffff, 3);
    light.position.set(-3, 4, 5);
    this.scene.add(new HemisphereLight(0xffffff, 0xc5ced4, 2), light);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enabled = false;
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.65;
    this.controls.minPolarAngle = 0.08;
    this.controls.maxPolarAngle = Math.PI - 0.08;
    this.resize();
  }

  get active(): boolean { return !!this.model; }
  get distance(): number { return this.camera.position.distanceTo(this.controls.target); }

  open(sculpture: Sculpture): boolean {
    if (this.active) return true;
    const model = sculpture.inspectionCopy();
    if (!model) return false;
    model.traverse((object) => { if (object instanceof Mesh) object.material = this.material; });
    this.model = model;
    this.scene.add(model);
    this.radius = new Box3().setFromObject(model).getBoundingSphere(new Sphere()).radius;
    this.controls.target.set(0, 0, 0);
    this.resize();
    this.camera.position.set(0, 0, this.fittedDistance());
    this.camera.lookAt(this.controls.target);
    this.controls.enabled = true;
    this.controls.update();
    return true;
  }

  private fittedDistance(): number {
    const vertical = MathUtils.degToRad(this.camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * this.camera.aspect);
    return this.radius / Math.sin(Math.min(vertical, horizontal)) * 1.18;
  }

  resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    const distance = this.fittedDistance();
    this.controls.minDistance = distance * 0.88;
    this.controls.maxDistance = distance * 1.5;
    if (this.active && this.camera.position.lengthSq()) {
      this.camera.position.setLength(MathUtils.clamp(this.distance, this.controls.minDistance, this.controls.maxDistance));
      this.controls.update();
    }
  }

  render(renderer: WebGLRenderer, environment: Scene): void {
    this.controls.update();
    this.scene.environment = environment.environment;
    renderer.render(this.scene, this.camera);
  }

  close(): void {
    this.controls.enabled = false;
    if (this.model) this.scene.remove(this.model);
    // Geometry belongs to the exhibition; inspection copies only share it.
    this.model = undefined;
  }

  dispose(): void {
    this.close();
    this.controls.dispose();
    this.material.dispose();
  }
}

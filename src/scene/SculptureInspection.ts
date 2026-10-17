import {
  Box3, Color, DirectionalLight, Group, HemisphereLight, MathUtils, Mesh,
  PerspectiveCamera, Scene, Sphere, type WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Sculpture } from './Sculpture';
import { createWeaponMaterial } from '../assets/WeaponAppearance';

export class SculptureInspection {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(40, 1, 0.02, 100);
  readonly controls: OrbitControls;
  private readonly material = createWeaponMaterial();
  private model?: Group;
  private radius = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.scene.background = new Color(0xf8fafb);
    const key = new DirectionalLight(0xfffcf7, 2.4);
    key.position.set(-3, 4, 5);
    const fill = new DirectionalLight(0xeaf4fa, 1.3);
    fill.position.set(4, 1, 3);
    const rim = new DirectionalLight(0xf4f8fc, 2);
    rim.position.set(2, 3, -4);
    this.scene.add(new HemisphereLight(0xffffff, 0xc5ced4, 1.2), key, fill, rim);
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
    const copy = sculpture.inspectionCopy();
    if (!copy) return false;
    copy.traverse((object) => { if (object instanceof Mesh) object.material = this.material; });
    // Rotate around the centered exhibit, independently of the visitor and orbit camera.
    const model = new Group();
    model.name = 'inspection-sculpture';
    model.add(copy);
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
    this.controls.minDistance = this.radius * 1.12;
    this.controls.maxDistance = distance * 1.5;
    if (this.active && this.camera.position.lengthSq()) {
      this.camera.position.setLength(MathUtils.clamp(this.distance, this.controls.minDistance, this.controls.maxDistance));
      this.controls.update();
    }
  }

  render(renderer: WebGLRenderer, environment: Scene, dt: number): void {
    if (this.model) this.model.rotation.y = (this.model.rotation.y + dt * Math.PI * 2 / 80) % (Math.PI * 2);
    this.controls.update(dt);
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

import {
  Box3, Group, Mesh, MeshStandardMaterial, Vector3, type Material,
  type Object3D, type Scene,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Atmosphere } from './Atmosphere';

export const SCULPTURE_COLOR = 0x080808;
export const SCULPTURE_ROUGHNESS = 0.82;
export const SCULPTURE_HEIGHT = 0.95;

/** Keep the exhibit at the original floating baseline and world scale. */
export class Sculpture {
  readonly root = new Group();
  loaded = false;
  private disposed = false;

  constructor(scene: Scene, private readonly atmosphere: Atmosphere) {
    const material = new MeshStandardMaterial({
      color: 0xd9dee0, metalness: 0.7, roughness: 0.26, envMapIntensity: 1.05,
    });
    atmosphere.apply(material);
    const placeholder = new Mesh(new RoundedBoxGeometry(0.65, 1.4, 0.45, 3, 0.009), material);
    placeholder.position.y = 0.7;
    placeholder.castShadow = true;
    placeholder.receiveShadow = true;
    this.root.add(placeholder);
    this.root.position.y = 1.33;
    this.root.rotation.y = 0.37;
    scene.add(this.root);
  }

  update(dt: number): void { this.root.rotation.y = (this.root.rotation.y + dt * Math.PI * 2 / 54) % (Math.PI * 2); }

  inRange(position: Vector3): boolean {
    return this.loaded && Math.hypot(position.x - this.root.position.x, position.z - this.root.position.z) <= 3.6;
  }

  inspectionCopy(): Group | undefined {
    if (!this.loaded) return;
    const copy = this.root.clone(true);
    copy.position.set(0, 0, 0);
    copy.rotation.set(0, Math.PI / 2 - 0.3, 0);
    copy.position.sub(new Box3().setFromObject(copy).getCenter(new Vector3()));
    return copy;
  }

  async loadModel(url: string): Promise<void> {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { scene: model } = await new GLTFLoader().loadAsync(url);
    if (this.disposed) { this.disposeObject(model); return; }
    const box = new Box3().setFromObject(model);
    const size = box.getSize(new Vector3());
    if (size.y <= 0) { this.disposeObject(model); throw new Error('The sculpture model has no measurable height.'); }
    const center = box.getCenter(new Vector3());
    const scale = SCULPTURE_HEIGHT / size.y;
    model.scale.multiplyScalar(scale);
    model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    const material = new MeshStandardMaterial({ color: SCULPTURE_COLOR, metalness: 0, roughness: SCULPTURE_ROUGHNESS, envMapIntensity: 0.6 });
    this.atmosphere.apply(material);
    const authoredMaterials = new Set<Material>();
    model.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = object.receiveShadow = true;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => authoredMaterials.add(material));
        object.material = material;
      }
    });
    this.disposeMaterials(authoredMaterials);
    for (const child of [...this.root.children]) { this.root.remove(child); this.disposeObject(child); }
    this.root.add(model);
    this.loaded = true;
  }

  private disposeObject(object: Object3D): void {
    const materials = new Set<Material>();
    object.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.geometry.dispose();
      (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => materials.add(material));
    });
    this.disposeMaterials(materials);
  }

  private disposeMaterials(materials: Set<Material>): void {
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && typeof value === 'object' && 'isTexture' in value && value.isTexture) value.dispose();
      }
      material.dispose();
    }
  }

  dispose(): void { this.disposed = true; this.disposeObject(this.root); }
}

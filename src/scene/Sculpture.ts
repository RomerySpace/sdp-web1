import {
  Box3, Group, Mesh, MeshStandardMaterial, Vector3, type Material,
  type Object3D, type Scene,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Atmosphere } from './Atmosphere';

/** Replaceable exhibit: a model is normalized to 1.4m tall, then placed at the
 * same floating baseline. Its own materials and authored orientation survive. */
export class Sculpture {
  readonly root = new Group();
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

  async loadModel(url: string): Promise<void> {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { scene: model } = await new GLTFLoader().loadAsync(url);
    if (this.disposed) { this.disposeObject(model); return; }
    const box = new Box3().setFromObject(model);
    const size = box.getSize(new Vector3());
    if (size.y <= 0) { this.disposeObject(model); throw new Error('The sculpture model has no measurable height.'); }
    const center = box.getCenter(new Vector3());
    const scale = 1.4 / size.y;
    model.scale.multiplyScalar(scale);
    model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    model.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = object.receiveShadow = true;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if (material instanceof MeshStandardMaterial) this.atmosphere.apply(material);
        });
      }
    });
    for (const child of [...this.root.children]) { this.root.remove(child); this.disposeObject(child); }
    this.root.add(model);
  }

  private disposeObject(object: Object3D): void {
    const materials = new Set<Material>();
    object.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.geometry.dispose();
      (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => materials.add(material));
    });
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && typeof value === 'object' && 'isTexture' in value && value.isTexture) value.dispose();
      }
      material.dispose();
    }
  }

  dispose(): void { this.disposed = true; this.disposeObject(this.root); }
}

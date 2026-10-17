import {
  CanvasTexture, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, Scene,
} from 'three';
import type { Atmosphere } from './Atmosphere';
import { createMonolithGeometry, monolithFinish } from './MonolithGeometry';
import { lobbyAmbience } from '../core/LobbyAmbience';
import { LobbyRetreat } from './LobbyRetreat';

export class Environment {
  readonly retreat: LobbyRetreat;
  readonly occluders: Mesh[] = [];
  private readonly meshes: Mesh[] = [];
  private readonly shadowTexture: CanvasTexture;

  constructor(scene: Scene, atmosphere: Atmosphere) {
    const floorMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0 });
    floorMaterial.color.multiplyScalar(lobbyAmbience.floorReflectance);
    atmosphere.apply(floorMaterial);
    const floor = new Mesh(new PlaneGeometry(2000, 2000), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.meshes.push(floor);

    const pedestalMaterial = new MeshStandardMaterial(monolithFinish);
    atmosphere.apply(pedestalMaterial);
    const pedestal = new Mesh(createMonolithGeometry(), pedestalMaterial);
    pedestal.name = 'Monolith / satin foundation';
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    this.meshes.push(pedestal);
    this.occluders.push(floor, pedestal);

    // A baked, feathered occlusion decal adds broad contact softness without
    // requiring a costly screen-space AO pass or extra architectural geometry.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(128, 128);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const dx = Math.max(0, Math.abs((x + 0.5) / 128 - 0.5) * 4.8 - 1.05);
        const dz = Math.max(0, Math.abs((y + 0.5) / 128 - 0.5) * 4.8 - 1.05);
        const index = (y * 128 + x) * 4;
        image.data[index] = 111;
        image.data[index + 1] = 124;
        image.data[index + 2] = 133;
        image.data[index + 3] = Math.round(Math.exp(-(dx * dx + dz * dz) * 6) * 28);
      }
    }
    context.putImageData(image, 0, 0);
    this.shadowTexture = new CanvasTexture(canvas);
    const shadow = new Mesh(new PlaneGeometry(4.8, 4.8), new MeshBasicMaterial({
      map: this.shadowTexture, transparent: true, depthWrite: false, opacity: 0,
      toneMapped: false, fog: true,
    }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.004;
    this.meshes.push(shadow);
    scene.add(...this.meshes);
    this.retreat = new LobbyRetreat(scene, atmosphere);
    this.occluders.push(...this.retreat.seats);
    this.retreat.ready.then(() => {
      this.retreat.tree.traverse(object => { if (object instanceof Mesh && object.name.toLowerCase().includes('tronco')) this.occluders.push(object); });
    });
  }

  update(reveal: number): void {
    (this.meshes[2].material as MeshBasicMaterial).opacity = reveal;
  }

  dispose(): void {
    this.retreat.dispose();
    this.shadowTexture.dispose();
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => material.dispose());
    }
  }
}

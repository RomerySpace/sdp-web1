import { CanvasTexture, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Raycaster, Vector2, type Camera, type Object3D, type Scene } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ambientStation } from '../../shared/AmbientStation';
import type { Atmosphere } from './Atmosphere';

export class AmbientStation {
  readonly group = new Group();
  readonly solids: Mesh[] = [];
  private readonly ray = new Raycaster();
  private readonly center = new Vector2();
  private readonly materials: (MeshStandardMaterial | MeshBasicMaterial)[] = [];
  private readonly texture: CanvasTexture;
  private readonly lamps: Mesh[] = [];
  constructor(scene: Scene, atmosphere: Atmosphere) {
    this.group.name = 'Limbo / ambient instrument'; this.group.position.set(ambientStation.x, 0, ambientStation.z);
    const white = new MeshStandardMaterial({ color: 0xe6ecee, roughness: .88 });
    const dark = new MeshStandardMaterial({ color: 0x43535c, roughness: .95 });
    const light = new MeshStandardMaterial({ color: 0xc9e1e8, roughness: .7, emissive: 0xb9dbe6, emissiveIntensity: .2 });
    this.materials.push(white, dark, light); [white, dark, light].forEach(m => atmosphere.apply(m));
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, material = white) => {
      const mesh = new Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(.1, h / 3)), material);
      mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; this.group.add(mesh); return mesh;
    };
    this.solids.push(box(3.2, .17, 1.15, 0, 1.04, 0), box(.34, .92, .8, -1.24, .46, 0), box(.34, .92, .8, 1.24, .46, 0));
    box(2.86, .025, .85, 0, 1.135, 0, dark);
    const whites = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23];
    for (let i = 0; i < whites.length; i++) box(.124, .03, .36, -.88 + i * .135, 1.165, .21);
    for (let i = 0; i < whites.length - 1; i++) if (whites[i + 1] - whites[i] === 2) box(.07, .045, .22, -.8125 + i * .135, 1.195, .12, dark);
    for (let i = 0; i < 4; i++) {
      const x = -.79 + i * .53;
      this.lamps.push(box(.4, .015, .045, x, 1.16, -.33, light));
      for (let j = 0; j < 2; j++) {
        const knob = new Mesh(new CylinderGeometry(.045, .045, .035, 16), white); knob.position.set(x + j * .14, 1.175, -.17); this.group.add(knob);
      }
    }
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 128;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#596b74'; ctx.font = '32px Helvetica'; ctx.textAlign = 'center'; ctx.fillText('SDP     /     FIELD INSTRUMENT', 512, 76);
    this.texture = new CanvasTexture(canvas);
    const labelMaterial = new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }); this.materials.push(labelMaterial);
    const label = new Mesh(new PlaneGeometry(2.3, .28), labelMaterial); label.position.set(0, .94, .584); this.group.add(label);
    scene.add(this.group);
  }
  focus(camera: Camera, occluders: Object3D[]): boolean {
    if (Math.hypot(camera.position.x - ambientStation.x, camera.position.z - ambientStation.z) > ambientStation.interactionDistance) return false;
    this.ray.setFromCamera(this.center, camera); this.ray.far = ambientStation.interactionDistance;
    const hit = this.ray.intersectObject(this.group, true)[0];
    return !!hit && !this.ray.intersectObjects(occluders, true).some(other => !this.solids.includes(other.object as Mesh) && other.distance < hit.distance - .03);
  }
  update(occupied: boolean, phase: number): void { this.lamps.forEach((lamp, i) => lamp.scale.y = occupied ? 1.5 + Math.sin(phase * 2 + i) * .4 : 1); }
  dispose(): void { this.group.removeFromParent(); this.group.traverse(o => { if (o instanceof Mesh) o.geometry.dispose(); }); this.materials.forEach(m => m.dispose()); this.texture.dispose(); }
}

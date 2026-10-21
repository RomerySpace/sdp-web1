import { BoxGeometry, BufferGeometry, CylinderGeometry, DataTexture, ExtrudeGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion, RGBAFormat, Shape, SphereGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Three shared meshes per headset: spring band, metal cups and porous foam. */
export class ListeningHeadphones {
  private readonly geometries: BufferGeometry[] = [];
  private readonly foamTexture: DataTexture;
  private readonly materials: MeshStandardMaterial[];
  constructor() {
    const pixels = new Uint8Array(64 * 64 * 4); let seed = 149;
    for (let i = 0; i < pixels.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = 60 + Math.floor(seed / 4294967296 * 195);
      pixels.set([noise, noise, noise, 255], i);
    }
    this.foamTexture = new DataTexture(pixels, 64, 64, RGBAFormat); this.foamTexture.needsUpdate = true;
    this.materials = [new MeshStandardMaterial({ color: 0xffffff, roughness: .55, metalness: .08, fog: false }),
      new MeshStandardMaterial({ color: 0xffffff, roughness: .38, metalness: .12, fog: false }),
      new MeshStandardMaterial({ color: 0xffffff, roughness: .98, bumpMap: this.foamTexture, bumpScale: .002, fog: false })];
    const parts: BufferGeometry[][] = [[], [], []];
    const add = (index: number, geometry: BufferGeometry, position = new Vector3(), rotation = new Quaternion(), scale = new Vector3(1, 1, 1)) => {
      const flat = geometry.index ? geometry.toNonIndexed() : geometry;
      flat.applyMatrix4(new Matrix4().compose(position, rotation, scale)); parts[index].push(flat);
      if (flat !== geometry) geometry.dispose();
    };
    const band = new Shape();
    for (let i = 0; i <= 40; i++) {
      const a = i / 40 * Math.PI, x = Math.cos(a) * .145, y = .075 + Math.sin(a) * .205;
      if (!i) band.moveTo(x, y); else band.lineTo(x, y);
    }
    for (let i = 40; i >= 0; i--) { const a = i / 40 * Math.PI; band.lineTo(Math.cos(a) * .135, .075 + Math.sin(a) * .195); }
    band.closePath(); add(0, new ExtrudeGeometry(band, { depth: .022, bevelEnabled: true, bevelSize: .001, bevelThickness: .001, bevelSegments: 2, steps: 1 }), new Vector3(0, 0, -.011));
    const sideways = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    for (const side of [-1, 1]) {
      add(1, new BoxGeometry(.007, .085, .014), new Vector3(side * .14, .057, 0));
      add(1, new CylinderGeometry(.052, .052, .014, 32), new Vector3(side * .153, .005, 0), sideways);
      add(0, new CylinderGeometry(.055, .055, .018, 32), new Vector3(side * .143, .005, 0), sideways);
      add(2, new SphereGeometry(1, 28, 18), new Vector3(side * .124, .005, 0), new Quaternion(), new Vector3(.025, .066, .066));
      for (let row = -2; row <= 2; row++) for (let column = -3; column <= 3; column++)
        add(0, new CylinderGeometry(.0014, .0014, .001, 5), new Vector3(side * .1605, row * .006, column * .006), sideways);
    }
    for (const set of parts) { this.geometries.push(mergeGeometries(set)!); set.forEach(g => g.dispose()); }
  }
  create(): Group {
    const group = new Group(); group.name = 'Gallery headphones';
    this.geometries.forEach((geometry, i) => { const mesh = new Mesh(geometry, this.materials[i]); mesh.name = ['Headphones / white spring band', 'Headphones / white satin cups', 'Headphones / white foam'][i]; group.add(mesh); });
    return group;
  }
  dispose(): void { this.geometries.forEach(g => g.dispose()); this.materials.forEach(m => m.dispose()); this.foamTexture.dispose(); }
}

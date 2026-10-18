import { Box3, Group, Mesh, MeshStandardMaterial, Raycaster, Vector2, Vector3, type Camera, type Material, type Object3D, type Scene, type Texture } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { lobbyRetreat, lobbyBenches } from '../../shared/LobbyRetreat';
import { listeningGarden, listeningGardenBenches, lobbyGroundHeight } from '../../shared/ListeningGarden';
import type { Atmosphere } from './Atmosphere';
import { assetBuffer } from '../assets/AssetCache';

function gardenCurve(geometry: RoundedBoxGeometry): RoundedBoxGeometry {
  const positions = geometry.getAttribute('position'), radius = listeningGarden.radius;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const halfWidth = lobbyRetreat.seatWidth / 2, bias = (radius - Math.sqrt(radius * radius - halfWidth * halfWidth)) / 2;
    positions.setZ(i, positions.getZ(i) + Math.sqrt(radius * radius - x * x) - radius + bias);
  }
  positions.needsUpdate = true; geometry.computeVertexNormals();
  return geometry;
}

export class LobbyRetreat {
  readonly group = new Group();
  readonly seats: Mesh[] = [];
  readonly tree = new Group();
  readonly ready: Promise<void>;
  treeLoaded = false;
  private disposed = false;
  private readonly raycaster = new Raycaster();
  private readonly center = new Vector2();
  focusSeat(camera: Camera, occluders: Object3D[]): number | undefined {
    this.raycaster.setFromCamera(this.center, camera); this.raycaster.far = lobbyRetreat.interactionDistance;
    const hit = this.raycaster.intersectObjects(this.seats, true)[0];
    if (!hit || this.raycaster.intersectObjects(occluders, true).some(other => other.object !== hit.object && other.distance < hit.distance - .03)) return;
    const index = this.seats.findIndex(seat => seat === hit.object || seat === hit.object.parent), seat = lobbyBenches[index];
    if (!seat) return;
    if (camera.position.y - lobbyGroundHeight(camera.position.x, camera.position.z) > 1.85 || Math.hypot(camera.position.x - seat.x, camera.position.z - seat.z) > lobbyRetreat.interactionDistance) return;
    const local = this.seats[index].worldToLocal(hit.point.clone());
    return index * 2 + (local.x >= 0 ? 1 : 0);
  }
  private readonly finish = new MeshStandardMaterial({ color: 0xf5f7f8, roughness: .91, metalness: 0 });
  private readonly seatGeometry = new RoundedBoxGeometry(lobbyRetreat.seatWidth, lobbyRetreat.seatHeight, lobbyRetreat.seatDepth, 5, .2);
  private readonly gardenSeatGeometry = gardenCurve(new RoundedBoxGeometry(lobbyRetreat.seatWidth, lobbyRetreat.seatHeight, .6, 7, .18));
  private readonly gardenBackGeometry = gardenCurve(new RoundedBoxGeometry(lobbyRetreat.seatWidth, listeningGarden.backHeight, .2, 5, .09));
  constructor(scene: Scene, atmosphere: Atmosphere) {
    this.group.name = 'Limbo / listening tree';
    atmosphere.apply(this.finish);
    this.tree.name = 'Listening tree / Lloque'; this.tree.position.set(lobbyRetreat.x, 0, lobbyRetreat.z); this.group.add(this.tree);
    for (const seat of lobbyBenches) {
      const mesh = new Mesh(this.seatGeometry, this.finish); mesh.name = 'Listening seat';
      mesh.position.set(seat.x, lobbyGroundHeight(seat.x, seat.z) + lobbyRetreat.seatHeight / 2, seat.z); mesh.rotation.y = seat.yaw;
      mesh.castShadow = mesh.receiveShadow = true; this.seats.push(mesh); this.group.add(mesh);
      if (listeningGardenBenches.includes(seat)) {
        mesh.name = 'Listening garden / inward-facing seat';
        mesh.geometry = this.gardenSeatGeometry;
        const back = new Mesh(this.gardenBackGeometry, this.finish);
        back.name = 'Listening garden / soft enclosing edge';
        // Entire back stays inside the shared bench footprint used by both simulations.
        back.position.set(0, lobbyRetreat.seatHeight / 2 + listeningGarden.backHeight / 2 - .08, .12);
        back.rotation.x = .06;
        back.castShadow = back.receiveShadow = true; mesh.add(back);
      }
    }
    scene.add(this.group);
    this.ready = this.loadTree(atmosphere).catch(error => { this.tree.userData.error = String(error); console.warn('[SDP] Listening tree unavailable.', error); });
  }
  private async loadTree(atmosphere: Atmosphere): Promise<void> {
    const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/loaders/DRACOLoader.js')]);
    if (this.disposed) return;
    const decoder = new DRACOLoader().setDecoderPath('/draco/').setWorkerLimit(1);
    try {
      const { scene: model } = await new GLTFLoader().setDRACOLoader(decoder).parseAsync(await assetBuffer('/models/tree.glb'), '/models/');
      if (this.disposed) { this.disposeModel(model); return; }
      const bounds = new Box3().setFromObject(model), height = bounds.getSize(new Vector3()).y;
      if (!(height > 0)) { this.disposeModel(model); throw new Error('Tree model has no measurable height.'); }
      const scale = lobbyRetreat.treeHeight / height; model.scale.multiplyScalar(scale); model.position.y -= bounds.min.y * scale;
      model.traverse(object => {
        if (!(object instanceof Mesh)) return;
        object.castShadow = false; object.receiveShadow = true;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material instanceof MeshStandardMaterial) atmosphere.apply(material);
      });
      this.tree.add(model); this.treeLoaded = true;
    } finally { decoder.dispose(); }
  }
  private disposeModel(model: Object3D): void {
    const materials = new Set<Material>(), textures = new Set<Texture>();
    model.traverse(object => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    for (const material of materials) {
      for (const value of Object.values(material)) if (value && typeof value === 'object' && value.isTexture) textures.add(value);
      material.dispose();
    }
    for (const texture of textures) { texture.dispose(); if (typeof texture.image?.close === 'function') texture.image.close(); }
  }
  dispose(): void {
    this.disposed = true; this.group.removeFromParent(); this.disposeModel(this.tree); this.tree.clear(); this.seatGeometry.dispose(); this.gardenSeatGeometry.dispose(); this.gardenBackGeometry.dispose(); this.finish.dispose();
  }
}

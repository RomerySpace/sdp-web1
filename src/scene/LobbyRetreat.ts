import { Box3, Group, Mesh, MeshStandardMaterial, Raycaster, Vector2, Vector3, type Camera, type Material, type Object3D, type Scene, type Texture } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { lobbyRetreat, lobbyBenches, lobbySeatSlots, gardenSeatStart, gardenSeatEnd, benchGroundHeight } from '../../shared/LobbyRetreat';
import { PLAYER_HEIGHT } from '../../shared/MultiplayerProtocol';
import { listeningGarden, listeningGardenBenches, lobbyGroundHeight } from '../../shared/ListeningGarden';
import type { Atmosphere } from './Atmosphere';
import { assetBuffer } from '../assets/AssetCache';
import { createListeningBench } from './ListeningBench';
import { lowerGallery, galleryFloor } from '../../shared/LowerGallery';

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
    const floor = galleryFloor(camera.position.x, camera.position.z, camera.position.y - PLAYER_HEIGHT) ?? lobbyGroundHeight(camera.position.x, camera.position.z);
    if (camera.position.y - floor > PLAYER_HEIGHT + .15) return;
    if (hit.object === this.gardenBench) {
      let closest = -1, distance = Infinity;
      for (let i = gardenSeatStart; i < gardenSeatEnd; i++) {
        const slot = lobbySeatSlots[i], d = Math.hypot(hit.point.x - slot.x, hit.point.z - slot.z);
        if (d < distance && Math.hypot(camera.position.x - slot.x, camera.position.z - slot.z) <= lobbyRetreat.interactionDistance) { closest = i; distance = d; }
      }
      return closest >= 0 ? closest : undefined;
    }
    const object = hit.object as Mesh, index = Number(object.userData.benchIndex ?? object.parent?.userData.benchIndex), seat = lobbyBenches[index];
    if (!seat) return;
    if (Math.hypot(camera.position.x - seat.x, camera.position.z - seat.z) > lobbyRetreat.interactionDistance) return;
    const local = object.worldToLocal(hit.point.clone());
    return index * 2 + (local.x >= 0 ? 1 : 0);
  }
  private readonly finish = new MeshStandardMaterial({ color: 0xf5f7f8, roughness: .91, metalness: 0 });
  private readonly galleryFinish = new MeshStandardMaterial({ color: 0xf0f3f4, roughness: .84, emissive: 0xffffff, emissiveIntensity: .12, fog: false });
  private readonly seatGeometry = new RoundedBoxGeometry(lobbyRetreat.seatWidth, lobbyRetreat.seatHeight, lobbyRetreat.seatDepth, 5, .2);
  private readonly gardenGeometry = createListeningBench();
  private readonly gardenBench = new Mesh(this.gardenGeometry, this.finish);
  constructor(scene: Scene, atmosphere: Atmosphere) {
    this.group.name = 'Limbo / listening tree';
    atmosphere.apply(this.finish);
    this.tree.name = 'Listening tree / Lloque'; this.tree.position.set(lobbyRetreat.x, 0, lobbyRetreat.z); this.group.add(this.tree);
    for (const [index, seat] of lobbyBenches.entries()) {
      if (listeningGardenBenches.includes(seat)) continue;
      const gallery = lowerGallery.benches.includes(seat);
      const mesh = new Mesh(this.seatGeometry, gallery ? this.galleryFinish : this.finish); mesh.name = gallery ? 'Gallery / listening bench' : 'Listening seat'; mesh.userData.benchIndex = index;
      mesh.position.set(seat.x, benchGroundHeight(seat) + lobbyRetreat.seatHeight / 2, seat.z); mesh.rotation.y = seat.yaw;
      mesh.castShadow = !gallery; mesh.receiveShadow = true; this.seats.push(mesh); this.group.add(mesh);
    }
    this.gardenBench.name = 'Listening garden / continuous curved bench';
    this.gardenBench.position.set(listeningGarden.x, -listeningGarden.depth, listeningGarden.z);
    this.gardenBench.castShadow = this.gardenBench.receiveShadow = true;
    this.group.add(this.gardenBench); this.seats.push(this.gardenBench);
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
    this.disposed = true; this.group.removeFromParent(); this.disposeModel(this.tree); this.tree.clear(); this.seatGeometry.dispose(); this.gardenGeometry.dispose(); this.finish.dispose(); this.galleryFinish.dispose();
  }
}

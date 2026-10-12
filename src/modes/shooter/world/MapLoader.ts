import { Box3, BufferAttribute, BufferGeometry, Group, Mesh, Raycaster, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { gameConfig } from '../config/gameConfig';
import { MarbleMaterial, type StoneKind } from './MarbleMaterial';
import { yieldFrame } from './MapColliders';
import { assetBuffer } from '../../../assets/AssetCache';

export class MapLoader {
  readonly root = new Group();
  readonly bounds = new Box3();
  readonly marble = new MarbleMaterial();
  readonly geometries: BufferGeometry[] = [];
  readonly audit: { name: string; kind: StoneKind; bounds: number[][]; triangles: number }[] = [];
  readonly stats = { sourceMeshes: 0, excludedHelpers: 0, triangles: 0, batches: 0 };
  /** Read-only geometry probe for collider alignment diagnostics. */
  trace(origin: Vector3, direction: Vector3, range: number) {
    const ray = new Raycaster(origin, direction, 0, range);
    return ray.intersectObject(this.root, true)[0] ?? null;
  }
  async load(progress: (text: string) => void): Promise<void> {
    const draco = new DRACOLoader().setDecoderPath('/shooter/draco/').setWorkerLimit(2);
    try {
      progress('Downloading Dust 2');
      const buffer = await assetBuffer(gameConfig.assets.map);
      progress('Decoding Dust 2');
      const gltf = await new GLTFLoader().setDRACOLoader(draco).parseAsync(buffer, '/shooter/MAP/');
      gltf.scene.scale.multiplyScalar(gameConfig.map.scale);
      gltf.scene.updateMatrixWorld(true);
      const meshes: Mesh[] = [];
      gltf.scene.traverse(o => { if (o instanceof Mesh) meshes.push(o); if (o instanceof SkinnedMesh) o.skeleton.update(); });
      const buckets = new Map<string, { kind: StoneKind; geometries: BufferGeometry[] }>();
      const point = new Vector3(), center = new Vector3();
      for (let mi = 0; mi < meshes.length; mi++) {
        const mesh = meshes[mi];
        const name = `${mesh.parent?.name ?? ''}/${mesh.name}`.toLowerCase();
        this.stats.sourceMeshes++;
        // Source compile helpers are not architecture. Overlays are coplanar decals.
        if (/blocklight|_shadow_meshset|mesh_overlay/.test(name)) { this.stats.excludedHelpers++; continue; }
        const source = mesh.geometry, g = new BufferGeometry();
        const positions = new Float32Array(source.getAttribute('position').count * 3);
        for (let i = 0; i < positions.length / 3; i++) { mesh.getVertexPosition(i, point); point.toArray(positions, i * 3); }
        g.setAttribute('position', new BufferAttribute(positions, 3));
        if (source.getAttribute('normal') && !(mesh instanceof SkinnedMesh)) g.setAttribute('normal', source.getAttribute('normal').clone());
        const indices = source.index ? new Uint32Array(source.index.array) : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
        if (mesh.matrixWorld.determinant() < 0) for (let i = 0; i < indices.length; i += 3) { const swap = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = swap; }
        g.setIndex(new BufferAttribute(indices, 1));
        if (!g.hasAttribute('normal')) g.computeVertexNormals();
        g.applyMatrix4(mesh.matrixWorld);
        g.computeBoundingBox();
        const bounds = g.boundingBox!;
        this.bounds.union(bounds);
        bounds.getCenter(center);
        const kind: StoneKind = /car00|hmmwv/.test(name) ? 'vehicle' : /crate|box|barrel|barricade/.test(name) ? 'cover' : /floor|sand|blacktop|steps|curb|pavement/.test(name) ? 'floor' : 'wall';
        this.audit.push({ name, kind, bounds: [bounds.min.toArray(), bounds.max.toArray()], triangles: indices.length / 3 });
        this.stats.triangles += indices.length / 3;
        const cell = gameConfig.map.batchSize;
        const key = `${kind}/${Math.floor(center.x / cell)}/${Math.floor(center.z / cell)}`;
        if (!buckets.has(key)) buckets.set(key, { kind, geometries: [] });
        buckets.get(key)!.geometries.push(g);
        if (mi % 20 === 0) { progress(`Reading architecture · ${Math.round(mi / meshes.length * 100)}%`); await yieldFrame(); }
      }
      for (const [key, bucket] of buckets) {
        const g = mergeGeometries(bucket.geometries)!;
        bucket.geometries.forEach(g => g.dispose());
        g.computeBoundingSphere(); g.computeBoundingBox();
        const mesh = new Mesh(g, this.marble.get(bucket.kind));
        mesh.name = key; mesh.castShadow = mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.root.add(mesh); this.geometries.push(g);
        await yieldFrame();
      }
      this.stats.batches = this.root.children.length;
      // Release decoded original GPU resources; source GLBs on disk are never modified.
      const disposed = new Set<unknown>();
      for (const mesh of meshes) {
        if (!disposed.has(mesh.geometry)) { mesh.geometry.dispose(); disposed.add(mesh.geometry); }
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (disposed.has(m)) continue;
          m.dispose(); disposed.add(m);
        }
      }
    } finally { draco.dispose(); }
  }
  dispose(): void { this.geometries.forEach(g => g.dispose()); this.marble.dispose(); this.root.clear(); }
}

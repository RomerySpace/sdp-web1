import { RAPIER, type PhysicsWorld } from '../physics/PhysicsWorld';
import { assetBuffer } from '../../../assets/AssetCache';
import { decodeCollisionAsset, shooterCollisionAsset, type CollisionAsset } from '../../../../shared/ShooterCollisionAsset';

export const yieldFrame = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
let collisionData: Promise<CollisionAsset> | undefined;
function loadCollisions(): Promise<CollisionAsset> {
  collisionData ??= assetBuffer(shooterCollisionAsset).then(async bytes => {
    const header = new Uint8Array(bytes);
    const buffer = header[0] === 0x1f && header[1] === 0x8b
      ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : bytes;
    return decodeCollisionAsset(buffer);
  }).catch(error => { collisionData = undefined; throw error; });
  return collisionData;
}

/** The browser and authoritative server load exactly the same solid surfaces. */
export async function buildMapColliders(physics: PhysicsWorld, progress: (text: string) => void): Promise<number> {
  progress('Downloading shared collision surfaces');
  const data = await loadCollisions();
  let count = 0;
  for (const geometry of data.colliders) {
    physics.world.createCollider(RAPIER.ColliderDesc.trimesh(geometry.vertices, geometry.indices).setFriction(0).setRestitution(0));
    count++;
    progress(`Reconstructing solid surfaces · ${Math.round(count / data.colliders.length * 100)}%`);
    await yieldFrame();
  }
  physics.world.updateSceneQueries();
  return count;
}

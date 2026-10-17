import { MeshPhysicalMaterial } from 'three';

// One product finish for the exhibit, inspection and playable weapon.
export const weaponFinish = { color: 0x101113, metalness: 0.25, roughness: 0.4, clearcoat: 0.08 } as const;

export function createWeaponMaterial(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial(weaponFinish);
}

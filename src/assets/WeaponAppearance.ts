import { MeshPhysicalMaterial } from 'three';

// One product finish for the exhibit, inspection and playable weapon.
export const weaponFinish = { color: 0xb9b7ad, metalness: 0.72, roughness: 0.28, clearcoat: 0.15 } as const;

export function createWeaponMaterial(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial(weaponFinish);
}

import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Vector3 } from 'three';

export const monolithFinish = { color: 0xffffff, roughness: .62, metalness: 0, envMapIntensity: .3 };
const sides = 72;
function monolithProfile(): { radius: number; height: number }[] {
  const profile = new CatmullRomCurve3([
    new Vector3(1.19, -.06, 0), new Vector3(1.19, -.015, 0),
    new Vector3(1.15, .025, 0), new Vector3(1.07, .10, 0),
    new Vector3(.99, .20, 0), new Vector3(.93, .36, 0),
    new Vector3(.91, .65, 0), new Vector3(.93, .97, 0),
    new Vector3(.93, 1.08, 0), new Vector3(.91, 1.16, 0),
    new Vector3(.855, 1.195, 0), new Vector3(.80, 1.20, 0),
  ]);
  return Array.from({ length: 41 }, (_, ring) => {
    const point = profile.getPoint(ring / 40);
    return { radius: Math.min(point.x, 1.2), height: Math.min(point.y, 1.2) };
  });
}
function sectionGeometry(profile: { radius: number; height: number }[]): BufferGeometry {
  const rings = profile.length - 1, positions: number[] = [], indices: number[] = [];
  for (let ring = 0; ring <= rings; ring++) {
    const { radius, height } = profile[ring];
    for (let side = 0; side < sides; side++) {
      const angle = side / sides * Math.PI * 2, x = Math.cos(angle), z = Math.sin(angle);
      positions.push(Math.sign(x) * Math.sqrt(Math.abs(x)) * radius, height, Math.sign(z) * Math.sqrt(Math.abs(z)) * radius);
      if (ring < rings) {
        const a = ring * sides + side, c = ring * sides + (side + 1) % sides;
        indices.push(a, a + sides, c, a + sides, c + sides, c);
      }
    }
  }
  const bottom = positions.length / 3;
  positions.push(0, profile[0].height, 0, 0, profile[rings].height, 0);
  for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides;
    indices.push(bottom, side, next, bottom + 1, rings * sides + next, rings * sides + side);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** A soft square section with a grounded, flared foot and a flat exhibit surface. */
export function createMonolithGeometry(): BufferGeometry { return sectionGeometry(monolithProfile()); }

/** Mirror the exhibit end above the weapon, then continue into the atmospheric horizon. */
export function createUpperMonolithGeometry(height = 300): BufferGeometry {
  const profile = monolithProfile().reverse().map(point => ({ radius: point.radius, height: 1.2 - point.height }));
  profile.push({ radius: profile.at(-1)!.radius, height });
  return sectionGeometry(profile);
}

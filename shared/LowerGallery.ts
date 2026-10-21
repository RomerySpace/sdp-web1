export const lowerGallery = {
  halfWidth: 12, halfDepth: 12, floorY: -7.2, ceilingY: -1.1,
  layerThreshold: -3.8,
  cornerRadius: 5,
  stairBottom: 12, stairTop: 30, stairHalfWidth: 3.6, stairZ: 0, openStairStart: 23.2,
  entranceHalfWidth: 7, flareStart: 21,
  stepHeight: .2, tread: .45, flightSteps: 18, landingLength: 1.8,
  benches: [-3.2, 0, 3.2].map(z => ({ x: 1, z, yaw: Math.PI / 2 })),
  film: { url: '/gallery/kenosis.mp4', x: -11.76, y: -5.35, z: -1.2, width: 3.2, height: 1.8 },
} as const;

export const galleryListening = {
  x: lowerGallery.film.x + .18, y: lowerGallery.floorY + .62, z: lowerGallery.film.z,
  interactionDistance: 2.6, hearingRadius: 18,
} as const;
export function canKeepGalleryHeadphones(p: { x: number; y: number; z: number }): boolean {
  return p.y < lowerGallery.layerThreshold && inGalleryRoom(p.x, p.z)
    && Math.hypot(p.x - galleryListening.x, p.z - galleryListening.z) <= galleryListening.hearingRadius;
}
export function canTakeGalleryHeadphones(p: { x: number; y: number; z: number }): boolean {
  return canKeepGalleryHeadphones(p) && Math.hypot(p.x - galleryListening.x, p.y - galleryListening.y, p.z - galleryListening.z) <= galleryListening.interactionDistance;
}
export function validGalleryListening(raw: unknown): raw is { listening: boolean } {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 1
    && 'listening' in raw && typeof raw.listening === 'boolean';
}

export function onGalleryStairs(x: number, z: number): boolean {
  return x >= lowerGallery.stairBottom && x <= lowerGallery.stairTop && Math.abs(z - lowerGallery.stairZ) < galleryStairWidth(x);
}
export function galleryStairWidth(x: number): number {
  const g = lowerGallery, t = Math.max(0, Math.min(1, (g.flareStart - x) / (g.flareStart - g.stairBottom)));
  return g.stairHalfWidth + (g.entranceHalfWidth - g.stairHalfWidth) * t;
}
export function galleryStairHeight(x: number): number {
  const g = lowerGallery, distance = Math.max(0, Math.min(g.stairTop - g.stairBottom, g.stairTop - x));
  const flight = g.flightSteps * g.tread;
  if (distance === 0) return 0;
  if (distance <= flight) return -Math.ceil(Math.max(0, distance - 1e-7) / g.tread) * g.stepHeight;
  if (distance <= flight + g.landingLength) return -g.flightSteps * g.stepHeight;
  return Math.max(g.floorY, -(g.flightSteps + Math.ceil((distance - flight - g.landingLength - 1e-7) / g.tread)) * g.stepHeight);
}
export function inGalleryRoom(x: number, z: number, margin = 0): boolean {
  const g = lowerGallery, qx = Math.abs(x) - (g.halfWidth - g.cornerRadius), qz = Math.abs(z) - (g.halfDepth - g.cornerRadius);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) < g.cornerRadius - margin;
}
export function galleryOutline(): { x: number; z: number }[] {
  const g = lowerGallery, points: { x: number; z: number }[] = [];
  for (let corner = 0; corner < 4; corner++) {
    const cx = (corner === 0 || corner === 3 ? 1 : -1) * (g.halfWidth - g.cornerRadius);
    const cz = (corner < 2 ? 1 : -1) * (g.halfDepth - g.cornerRadius);
    for (let i = 0; i <= 32; i++) {
      const angle = (corner + i / 32) * Math.PI / 2;
      points.push({ x: cx + Math.cos(angle) * g.cornerRadius, z: cz + Math.sin(angle) * g.cornerRadius });
    }
  }
  return points;
}
export function galleryImmersion(x: number, y: number, z: number): number {
  if (!inGalleryRoom(x, z) && !onGalleryStairs(x, z)) return 0;
  const t = Math.max(0, Math.min(1, (-y - .7) / 3.8)); return t * t * (3 - 2 * t);
}
export function galleryFloor(x: number, z: number, referenceGround = 0): number | undefined {
  if (onGalleryStairs(x, z)) return referenceGround >= -.1 && x < lowerGallery.openStairStart ? 0 : galleryStairHeight(x);
  if (referenceGround < lowerGallery.layerThreshold && inGalleryRoom(x, z)) return lowerGallery.floorY;
}
export function galleryBarrier(x: number, z: number, radius: number, referenceGround: number): boolean {
  const g = lowerGallery;
  // The covered flight is solid ground above; the exposed mouth has three guarded sides.
  const surface = referenceGround >= -.1;
  if (surface && Math.abs(x - g.openStairStart) < .18 + radius && Math.abs(z - g.stairZ) < g.stairHalfWidth + radius) return true;
  if (x > (surface ? g.openStairStart : g.stairBottom) - radius && x < g.stairTop && Math.abs(Math.abs(z - g.stairZ) - galleryStairWidth(x)) < .18 + radius) return true;
  if (referenceGround >= g.layerThreshold) return false;
  const inRoom = inGalleryRoom(x, z, radius);
  const inStair = x >= g.stairBottom - radius && x <= g.stairTop + radius && Math.abs(z - g.stairZ) < galleryStairWidth(x) - radius;
  return !inRoom && !inStair;
}

export const galleryGrassGLSL = `
float galleryGrass(vec2 p) {
  vec2 edge = abs(p - vec2(${(lowerGallery.stairTop + lowerGallery.openStairStart) / 2}, 0.0)) - vec2(${(lowerGallery.stairTop - lowerGallery.openStairStart) / 2}, 3.8);
  return smoothstep(0.0, .16, max(edge.x, edge.y));
}`;

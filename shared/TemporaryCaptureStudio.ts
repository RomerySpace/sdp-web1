// Temporary screenshot space. This flag disables its visuals, grass mask and collisions together.
export const temporaryCaptureStudio = {
  enabled: true, x: -20, z: 10, width: 16, depth: 14, height: 6.5,
  wall: .24, doorWidth: 2.8, doorHeight: 3.2,
} as const;
const c = temporaryCaptureStudio;
export const captureStudioWalls = [
  { x: c.x - c.width / 2, z: c.z, width: c.wall, depth: c.depth, height: c.height, y: c.height / 2 },
  ...[-1, 1].map(side => ({ x: c.x, z: c.z + side * c.depth / 2, width: c.width, depth: c.wall, height: c.height, y: c.height / 2 })),
  ...[-1, 1].map(side => ({ x: c.x + c.width / 2, z: c.z + side * (c.depth + c.doorWidth) / 4,
    width: c.wall, depth: (c.depth - c.doorWidth) / 2, height: c.height, y: c.height / 2 })),
  { x: c.x + c.width / 2, z: c.z, width: c.wall, depth: c.doorWidth,
    height: c.height - c.doorHeight, y: (c.height + c.doorHeight) / 2 },
  { x: c.x + c.width / 2 - 3.5, z: c.z, width: c.wall, depth: 5.2, height: c.height, y: c.height / 2 },
];
export function inCaptureStudio(x: number, z: number, margin = 0): boolean {
  return c.enabled && Math.abs(x - c.x) < c.width / 2 + margin && Math.abs(z - c.z) < c.depth / 2 + margin;
}
export function captureStudioBlocked(x: number, z: number, radius: number): boolean {
  return c.enabled && captureStudioWalls.some(wall => {
    if (wall.y - wall.height / 2 > 2) return false;
    const dx = Math.max(0, Math.abs(x - wall.x) - wall.width / 2);
    const dz = Math.max(0, Math.abs(z - wall.z) - wall.depth / 2);
    return dx * dx + dz * dz < radius * radius;
  });
}
export const captureStudioGrassGLSL = c.enabled ? `
  vec2 studioEdge = abs(wrapped - vec2(${c.x.toFixed(2)}, ${c.z.toFixed(2)})) - vec2(${(c.width / 2 + .15).toFixed(2)}, ${(c.depth / 2 + .15).toFixed(2)});
  root *= smoothstep(0., .12, max(studioEdge.x, studioEdge.y));
` : '';

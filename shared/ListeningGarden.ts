/** An open conversation hollow, separated from the sculpture and instrument. */
export const listeningGarden = {
  x: 3, z: 46, radius: 7.2,
  flatRadius: 8, outerRadius: 17, depth: 2.8,
  halfArc: Math.PI * 2 / 3, benchHalfDepth: .44,
  backHeight: .58,
} as const;

// Logical reservations along one continuous seat, not separate physical benches.
export const listeningGardenBenches = Array.from({ length: 12 }, (_, i) => -110 + i * 20).map(degrees => {
  const yaw = degrees * Math.PI / 180;
  return {
    x: listeningGarden.x + Math.sin(yaw) * listeningGarden.radius,
    z: listeningGarden.z + Math.cos(yaw) * listeningGarden.radius,
    yaw,
  };
});

export function listeningBenchDistance(x: number, z: number): number {
  const dx = x - listeningGarden.x, dz = z - listeningGarden.z;
  const angle = Math.max(-listeningGarden.halfArc, Math.min(listeningGarden.halfArc, Math.atan2(dx, dz)));
  return Math.hypot(dx - Math.sin(angle) * listeningGarden.radius, dz - Math.cos(angle) * listeningGarden.radius);
}

/** Smooth floor profile, identical in rendering, prediction and server simulation. */
export function lobbyGroundHeight(x: number, z: number): number {
  const distance = Math.hypot(x - listeningGarden.x, z - listeningGarden.z);
  if (distance >= listeningGarden.outerRadius) return 0;
  const t = Math.max(0, Math.min(1, (distance - listeningGarden.flatRadius) / (listeningGarden.outerRadius - listeningGarden.flatRadius)));
  return -listeningGarden.depth * (1 - t * t * (3 - 2 * t));
}

export const lobbyGroundGLSL = `
float listeningBenchDistance(vec2 p) {
  vec2 d = p - vec2(${listeningGarden.x.toFixed(3)}, ${listeningGarden.z.toFixed(3)});
  float a = clamp(atan(d.x, d.y), -${listeningGarden.halfArc.toFixed(8)}, ${listeningGarden.halfArc.toFixed(8)});
  return length(d - vec2(sin(a), cos(a)) * ${listeningGarden.radius.toFixed(3)});
}
float lobbyGroundHeight(vec2 p) {
  float d = length(p - vec2(${listeningGarden.x.toFixed(3)}, ${listeningGarden.z.toFixed(3)}));
  return -${listeningGarden.depth.toFixed(3)} * (1.0 - smoothstep(${listeningGarden.flatRadius.toFixed(3)}, ${listeningGarden.outerRadius.toFixed(3)}, d));
}`;

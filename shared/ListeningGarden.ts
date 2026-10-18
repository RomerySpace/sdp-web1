/** An open conversation hollow, separated from the sculpture and instrument. */
export const listeningGarden = {
  x: 3, z: 46, radius: 5.2,
  flatRadius: 5.8, outerRadius: 12.5, depth: 1.65,
  backHeight: .58,
} as const;

export const listeningGardenBenches = [-105, -75, -45, -15, 15, 45, 75, 105].map(degrees => {
  const yaw = degrees * Math.PI / 180;
  return {
    x: listeningGarden.x + Math.sin(yaw) * listeningGarden.radius,
    z: listeningGarden.z + Math.cos(yaw) * listeningGarden.radius,
    yaw,
  };
});

/** Smooth floor profile, identical in rendering, prediction and server simulation. */
export function lobbyGroundHeight(x: number, z: number): number {
  const distance = Math.hypot(x - listeningGarden.x, z - listeningGarden.z);
  if (distance >= listeningGarden.outerRadius) return 0;
  const t = Math.max(0, Math.min(1, (distance - listeningGarden.flatRadius) / (listeningGarden.outerRadius - listeningGarden.flatRadius)));
  return -listeningGarden.depth * (1 - t * t * (3 - 2 * t));
}

export const lobbyGroundGLSL = `
float lobbyGroundHeight(vec2 p) {
  float d = length(p - vec2(${listeningGarden.x.toFixed(3)}, ${listeningGarden.z.toFixed(3)}));
  return -${listeningGarden.depth.toFixed(3)} * (1.0 - smoothstep(${listeningGarden.flatRadius.toFixed(3)}, ${listeningGarden.outerRadius.toFixed(3)}, d));
}`;

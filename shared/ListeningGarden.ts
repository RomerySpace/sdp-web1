/** An open conversation hollow, separated from the sculpture and instrument. */
export const listeningGarden = {
  x: 3, z: 46, radius: 3.5,
  backHeight: .82,
} as const;

export const listeningGardenBenches = [-100, -60, -20, 20, 60, 100].map(degrees => {
  const yaw = degrees * Math.PI / 180;
  return {
    x: listeningGarden.x + Math.sin(yaw) * listeningGarden.radius,
    z: listeningGarden.z + Math.cos(yaw) * listeningGarden.radius,
    yaw,
  };
});

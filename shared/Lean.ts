export const leanConfig = { distance: .48, response: 12, radius: .22, roll: .22 };
export function leanOffset(distance: number, yaw: number): { x: number; y: number; z: number } {
  return { x: Math.cos(yaw) * distance, y: -Math.abs(distance) * .12, z: -Math.sin(yaw) * distance };
}

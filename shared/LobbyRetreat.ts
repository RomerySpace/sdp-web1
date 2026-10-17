/** Shared footprint for the tree, benches and client/server collisions. */
export const lobbyRetreat = {
  x: 36, z: -24, treeHeight: 9.5, trunkRadius: .55,
  interactionDistance: 2.7, seatedEye: 1.18, exitDistance: .95,
  seats: [
    { x: 31, z: -27, yaw: Math.atan2(-5, -3) },
    { x: 41, z: -27, yaw: Math.atan2(5, -3) },
    { x: 36, z: -18, yaw: 0 },
  ],
  seatWidth: 2.1, seatDepth: .75, seatHeight: .46,
} as const;

/** Two independently reserved places on each physical bench. */
export const lobbySeatSlots = lobbyRetreat.seats.flatMap((bench, benchIndex) =>
  [-.52, .52].map(offset => ({
    benchIndex, yaw: bench.yaw,
    x: bench.x + offset * Math.cos(bench.yaw),
    z: bench.z - offset * Math.sin(bench.yaw),
  })));

export function validSeatRequest(raw: unknown): raw is { seat: number } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const request = raw as Record<string, unknown>;
  return Object.keys(request).length === 1 && Number.isInteger(request.seat) && (request.seat as number) >= -1 && (request.seat as number) < lobbySeatSlots.length;
}

export function seatExits(index: number): { x: number; z: number }[] {
  const seat = lobbySeatSlots[index], s = Math.sin(seat.yaw), c = Math.cos(seat.yaw);
  return [[0, -lobbyRetreat.exitDistance], [0, lobbyRetreat.exitDistance], [lobbyRetreat.seatWidth / 2 + .7, 0], [-lobbyRetreat.seatWidth / 2 - .7, 0]]
    .map(([x, z]) => ({ x: seat.x + x * c + z * s, z: seat.z - x * s + z * c }));
}

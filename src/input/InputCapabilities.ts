export function usesTouchControls(): boolean {
  return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !('requestPointerLock' in HTMLElement.prototype));
}
export const touchConfig = { deadZone: .12, lookSensitivity: .003, stickTravel: .34 };

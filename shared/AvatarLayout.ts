import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import type { HitRegion } from './ShooterProtocol';
export class AvatarPart {
  readonly center = new Vector3(); readonly rotation = new Quaternion();
  readonly halfExtents = new Vector3(.08, .05, .12);
  height = .7;
  constructor(readonly region: HitRegion, readonly radius: number) {}
}
// One geometric pose drives both visible limbs and authoritative regional hitboxes.
export class AvatarLayout {
  readonly head = new AvatarPart('head', .19);
  readonly torso = new AvatarPart('torso', .25);
  readonly legs = [new AvatarPart('leg', .09), new AvatarPart('leg', .09)];
  readonly arms = [new AvatarPart('arm', .09), new AvatarPart('arm', .09)];
  readonly feet = [new AvatarPart('foot', 0), new AvatarPart('foot', 0)];
  readonly parts = [this.head, this.torso, ...this.arms, ...this.legs, ...this.feet];
  readonly weaponPosition = new Vector3(); readonly weaponRotation = new Euler();
  private readonly shoulder = new Vector3();
  private readonly hand = new Vector3();
  private readonly direction = new Vector3();
  private readonly axis = new Vector3(0, 1, 0);
  private readonly euler = new Euler();
  update(height: number, pitch: number, reload = 0): void {
    const crouch = MathUtils.clamp((1.8 - height) / .64, 0, 1);
    this.head.center.set(0, height - .19, 0);
    this.torso.center.set(0, 1.14 - crouch * .56, 0); this.torso.height = .88 * (1 - crouch * .12);
    this.weaponPosition.set(.22, 1.25 - crouch * .58 - reload * .14, -.25);
    this.weaponRotation.set(pitch, 0, reload * .35);
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i], arm = this.arms[i];
      leg.center.set(i ? .14 : -.14, .35 - crouch * .05, -crouch * .09);
      leg.height = .7 * (1 - crouch * .15); leg.rotation.setFromEuler(this.euler.set(-crouch * .7, 0, 0));
      this.feet[i].center.set(i ? .14 : -.14, .05, -.04);
      this.shoulder.set(i ? .29 : -.29, 1.4 - crouch * .56, 0);
      this.hand.set(0, i ? -.08 : -.03, i ? .12 : -.13).applyEuler(this.weaponRotation).add(this.weaponPosition);
      this.direction.subVectors(this.hand, this.shoulder);
      arm.center.copy(this.shoulder).add(this.hand).multiplyScalar(.5); arm.height = this.direction.length();
      arm.rotation.setFromUnitVectors(this.axis, this.direction.normalize());
    }
  }
}

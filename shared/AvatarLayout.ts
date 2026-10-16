import { Euler, MathUtils, Quaternion, Vector3 } from 'three';
import type { HitRegion } from './ShooterProtocol';
import type { AvatarGait } from './AvatarAnimation';
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
  readonly shins = [new AvatarPart('leg', .075), new AvatarPart('leg', .075)];
  readonly arms = [new AvatarPart('arm', .09), new AvatarPart('arm', .09)];
  readonly forearms = [new AvatarPart('arm', .067), new AvatarPart('arm', .067)];
  readonly feet = [new AvatarPart('foot', 0), new AvatarPart('foot', 0)];
  readonly parts = [this.head, this.torso, ...this.arms, ...this.forearms, ...this.legs, ...this.shins, ...this.feet];
  readonly hips = [new Vector3(), new Vector3()];
  readonly knees = [new Vector3(), new Vector3()];
  readonly ankles = [new Vector3(), new Vector3()];
  readonly hands = [new Vector3(), new Vector3()];
  readonly shoulders = [new Vector3(), new Vector3()];
  readonly elbows = [new Vector3(), new Vector3()];
  readonly weaponPosition = new Vector3(); readonly weaponRotation = new Euler();
  private readonly direction = new Vector3();
  private readonly axis = new Vector3(0, 1, 0);
  private readonly tilt = new Quaternion();
  private readonly weaponQuaternion = new Quaternion();
  private readonly leanAxis = new Vector3(0, 0, 1);
  private readonly bend = new Vector3();
  update(height: number, pitch: number, reload = 0, lean = 0, gait?: AvatarGait): void {
    this.head.rotation.identity(); this.torso.rotation.identity();
    const crouch = MathUtils.clamp((1.8 - height) / .64, 0, 1);
    const bounce = Math.abs(Math.sin((gait?.gaitPhase ?? 0) * 2)) * Math.hypot(gait?.gaitX ?? 0, gait?.gaitZ ?? 0) * .045;
    this.head.center.set(0, height - .19 + bounce, 0);
    this.torso.center.set(0, 1.14 - crouch * .56 + bounce, 0); this.torso.height = .88 * (1 - crouch * .12);
    this.weaponPosition.set(.22, 1.25 - crouch * .58 - reload * .14 + bounce, -.25);
    this.weaponRotation.set(pitch, 0, reload * .35);
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i];
      const phase = (gait?.gaitPhase ?? 0) + i * Math.PI;
      const stride = Math.sin(phase), reach = Math.hypot(gait?.gaitX ?? 0, gait?.gaitZ ?? 0);
      const lift = Math.max(0, Math.cos(phase)) * reach * .38;
      const hip = this.hips[i].set(i ? .14 : -.14, .82 - crouch * .38 + bounce, crouch * .08);
      const ankle = this.ankles[i].set((i ? .14 : -.14) + stride * (gait?.gaitX ?? 0), .12 + lift, stride * (gait?.gaitZ ?? 0));
      this.direction.subVectors(ankle, hip);
      const distance = this.direction.length(); this.direction.normalize();
      this.bend.set(0, 0, -1).addScaledVector(this.direction, this.direction.z).normalize();
      const knee = this.knees[i].copy(hip).add(ankle).multiplyScalar(.5)
        .addScaledVector(this.bend, Math.sqrt(Math.max(.002, .39 * .39 - distance * distance / 4)));
      this.segment(leg, hip, knee); this.segment(this.shins[i], knee, ankle);
      this.feet[i].center.copy(ankle); this.feet[i].center.y -= .07; this.feet[i].center.z -= .04;
      this.shoulders[i].set(i ? .29 : -.29, 1.4 - crouch * .56 + bounce, 0);
    }
    // Upper body bends from the waist; feet remain planted. The head matches the
    // authoritative eye displacement and the same layout is used by hit detection.
    const pivot = .68 - crouch * .34, length = height - .19 - pivot;
    const tilt = this.tilt.setFromAxisAngle(this.leanAxis, -Math.atan2(lean, length));
    for (const part of [this.head, this.torso]) {
      const weight = MathUtils.clamp((part.center.y - pivot) / length, 0, 1);
      part.center.x += lean * weight; part.center.y -= Math.abs(lean) * .12 * weight;
      part.rotation.premultiply(tilt);
    }
    for (const point of this.shoulders) {
      const weight = MathUtils.clamp((point.y - pivot) / length, 0, 1);
      point.x += lean * weight; point.y -= Math.abs(lean) * .12 * weight;
    }
    const weight = MathUtils.clamp((this.weaponPosition.y - pivot) / length, 0, 1);
    this.weaponPosition.x += lean * weight; this.weaponPosition.y -= Math.abs(lean) * .12 * weight;
    this.weaponRotation.setFromQuaternion(tilt.multiply(this.weaponQuaternion.setFromEuler(this.weaponRotation)));
    for (let i = 0; i < 2; i++) {
      const hand = this.hands[i].set(0, i ? -.08 : -.03, i ? .12 : -.13).applyEuler(this.weaponRotation).add(this.weaponPosition);
      const elbow = this.elbows[i].copy(this.shoulders[i]).add(hand).multiplyScalar(.5);
      elbow.x += i ? .075 : -.075; elbow.z += .07;
      this.segment(this.arms[i], this.shoulders[i], elbow); this.segment(this.forearms[i], elbow, hand);
    }
  }
  private segment(part: AvatarPart, start: Vector3, end: Vector3): void {
    part.center.copy(start).add(end).multiplyScalar(.5);
    this.direction.subVectors(end, start); part.height = this.direction.length();
    part.rotation.setFromUnitVectors(this.axis, this.direction.normalize());
  }
}

import { Group, MathUtils, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { anonymousFinish, FigureGeometry } from '../player/AnonymousFigure';

/** Viewmodel-only hands inherit the weapon springs, ADS, recoil and holstering. */
export class FirstPersonHands {
  readonly group = new Group();
  private readonly geometry = new FigureGeometry();
  private readonly material = new MeshStandardMaterial({ ...anonymousFinish, fog: false });
  private readonly hands: Mesh[];
  private readonly wrists: Mesh[];
  private readonly forearms: Mesh[];
  private readonly start = new Vector3();
  private readonly end = new Vector3();
  private readonly direction = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  constructor() {
    this.group.name = 'First-person white hands';
    this.hands = [new Mesh(this.geometry.leftHand, this.material), new Mesh(this.geometry.rightHand, this.material)];
    this.wrists = [new Mesh(this.geometry.joint, this.material), new Mesh(this.geometry.joint, this.material)];
    this.forearms = [new Mesh(this.geometry.limb, this.material), new Mesh(this.geometry.limb, this.material)];
    for (let i = 0; i < 2; i++) {
      this.hands[i].name = `pov-${i ? 'right' : 'left'}-hand`;
      this.wrists[i].scale.set(.032, .035, .043);
      this.group.add(this.hands[i], this.wrists[i], this.forearms[i]);
    }
    this.group.traverse(object => object.layers.set(1)); this.update(0);
  }
  update(reloadProgress: number): void {
    const reach = Math.sin(MathUtils.clamp(reloadProgress, 0, 1) * Math.PI);
    for (let i = 0; i < 2; i++) {
      const left = i === 0, hand = this.hands[i];
      hand.position.set(left ? -.038 : .044, left ? -.054 - reach * .15 : -.105, left ? -.13 + reach * .17 : .105);
      hand.rotation.set(left ? -.12 + reach * .65 : .05, left ? -.2 : .1, left ? .18 - reach * .3 : -.08);
      this.start.copy(hand.position); this.start.y -= .014; this.start.z += .035;
      this.wrists[i].position.copy(this.start);
      this.end.set(left ? -.30 : .24, -.28 - (left ? reach * .06 : 0), .42);
      this.direction.subVectors(this.end, this.start); const length = this.direction.length();
      this.forearms[i].position.copy(this.start).add(this.end).multiplyScalar(.5);
      this.forearms[i].quaternion.setFromUnitVectors(this.up, this.direction.normalize());
      this.forearms[i].scale.set(.047, length + .055, .049);
    }
  }
  dispose(): void { this.group.removeFromParent(); this.group.clear(); this.geometry.dispose(); this.material.dispose(); }
}

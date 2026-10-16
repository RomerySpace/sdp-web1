import { Bone, BufferGeometry, CapsuleGeometry, CatmullRomCurve3, Float32BufferAttribute, Group, LatheGeometry, Mesh, MeshStandardMaterial, Quaternion, Skeleton, SkinnedMesh, SphereGeometry, Uint16BufferAttribute, Vector2, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AvatarLayout } from '../../../../shared/AvatarLayout';

const up = new Vector3(0, 1, 0);
export const anonymousFinish = { color: 0xf4f6f7, roughness: .98, metalness: 0, envMapIntensity: .24, specularIntensity: .08, ior: 1.35, clearcoat: 0 };

/** Sample the silhouette as a curve so lighting never reveals the control rings. */
function smoothLathe(profile: [number, number][], sides: number, rings: number): LatheGeometry {
  const curve = new CatmullRomCurve3(profile.map(([radius, height]) => new Vector3(radius, height, 0)), false, 'centripetal');
  const minHeight = profile[0][1], maxHeight = profile.at(-1)![1];
  const points = curve.getPoints(rings).map(point => new Vector2(Math.max(0, point.x), Math.max(minHeight, Math.min(maxHeight, point.y))));
  return new LatheGeometry(points, sides);
}

function handGeometry(left: boolean): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const palm = new SphereGeometry(1, 20, 14); palm.scale(.036, .049, .026); parts.push(palm);
  const link = (a: Vector3, b: Vector3, radius: number) => {
    const direction = b.clone().sub(a), length = direction.length();
    const segment = new CapsuleGeometry(radius, Math.max(.001, length - radius * 2), 4, 10);
    segment.applyQuaternion(new Quaternion().setFromUnitVectors(up, direction.normalize()));
    segment.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); parts.push(segment);
  };
  for (let i = 0; i < 4; i++) {
    const y = .028 - i * .019, reach = i === 3 ? .037 : .047;
    const a = new Vector3(-.012, y, -.014), b = new Vector3(-reach, y, -.033), c = new Vector3(-reach - .008, y - .004, -.005);
    link(a, b, .0095); link(b, c, .009);
  }
  link(new Vector3(-.005, .032, .017), new Vector3(-.029, .049, -.001), .012);
  link(new Vector3(-.029, .049, -.001), new Vector3(-.048, .032, -.019), .0105);
  const geometry = mergeGeometries(parts)!; parts.forEach(part => part.dispose());
  if (left) { geometry.scale(-1, 1, 1); const index = geometry.index!; for (let i = 0; i < index.count; i += 3) { const a = index.getX(i); index.setX(i, index.getX(i + 1)); index.setX(i + 1, a); } }
  geometry.computeVertexNormals(); return geometry;
}

function softLimbGeometry(arm: boolean): BufferGeometry {
  const profile: [number, number][] = arm
    ? [[0, 0], [.065, .035], [.084, .15], [.076, .33], [.063, .5], [.066, .65], [.054, .83], [.034, .97], [0, 1]]
    : [[0, 0], [.085, .025], [.105, .16], [.1, .32], [.078, .5], [.077, .65], [.071, .8], [.048, .97], [0, 1]];
  const geometry = smoothLathe(profile, 20, 32);
  const positions = geometry.getAttribute('position'), indices: number[] = [], weights: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    const t = Math.max(0, Math.min(1, (positions.getY(i) - .35) / .3));
    const blend = t * t * (3 - 2 * t);
    indices.push(0, 1, 0, 0); weights.push(1 - blend, blend, 0, 0);
  }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  return geometry;
}

/** Native GPU skinning joins each limb smoothly across its bend. */
class SoftLimb {
  readonly mesh: SkinnedMesh;
  private readonly root = new Bone();
  private readonly bend = new Bone();
  private readonly direction = new Vector3();
  constructor(geometry: BufferGeometry, material: MeshStandardMaterial, name: string, bendName: string) {
    this.mesh = new SkinnedMesh(geometry, material); this.mesh.name = name;
    this.bend.name = bendName; this.bend.position.y = .5;
    this.mesh.add(this.root, this.bend); this.mesh.bind(new Skeleton([this.root, this.bend]));
    // The bind geometry is at the origin; the posed limbs are in body coordinates.
    this.mesh.frustumCulled = false;
  }
  update(start: Vector3, bend: Vector3, end: Vector3): void {
    this.pose(this.root, start, bend); this.pose(this.bend, bend, end);
  }
  private pose(bone: Bone, start: Vector3, end: Vector3): void {
    this.direction.subVectors(end, start); const length = this.direction.length();
    bone.position.copy(start); bone.quaternion.setFromUnitVectors(up, this.direction.normalize()); bone.scale.set(1, length * 2, 1);
  }
  dispose(): void { this.mesh.skeleton.dispose(); this.mesh.removeFromParent(); }
}

/** Shared smooth geometry; every remote figure reuses these buffers. */
export class FigureGeometry {
  readonly joint = new SphereGeometry(1, 20, 14);
  readonly head = smoothLathe([
    [0, -.19], [.065, -.18], [.12, -.14], [.158, -.065],
    [.17, .035], [.153, .13], [.10, .185], [0, .205],
  ], 32, 40);
  readonly torso = smoothLathe([
    [0, -.44], [.13, -.43], [.17, -.36], [.19, -.23],
    [.245, -.06], [.267, .13], [.25, .24], [.18, .32],
    [.085, .37], [.075, .43], [0, .44],
  ], 28, 40);
  readonly limb = smoothLathe([
    [0, -.5], [.65, -.48], [.86, -.39], [1, -.17],
    [.96, .16], [.78, .38], [.56, .48], [0, .5],
  ], 20, 32);
  readonly rightHand = handGeometry(false);
  readonly leftHand = handGeometry(true);
  readonly legSkin = softLimbGeometry(false);
  readonly armSkin = softLimbGeometry(true);
  dispose(): void { for (const geometry of [this.joint, this.head, this.torso, this.limb, this.rightHand, this.leftHand, this.legSkin, this.armSkin]) geometry.dispose(); }
}

export class AnonymousFigure {
  readonly group = new Group();
  readonly head: Mesh;
  readonly torso: Mesh;
  private readonly neck: Mesh;
  private readonly legs: SoftLimb[] = [];
  private readonly feet: Mesh[] = [];
  private readonly arms: SoftLimb[] = [];
  private readonly hands: Mesh[] = [];
  constructor(geometry: FigureGeometry, material: MeshStandardMaterial) {
    const mesh = (shape: BufferGeometry, name: string) => { const object = new Mesh(shape, material); object.name = name; this.group.add(object); return object; };
    this.group.name = 'Anonymous white figure';
    this.head = mesh(geometry.head, 'anonymous-head'); this.head.scale.set(1, 1, .94);
    this.torso = mesh(geometry.torso, 'anonymous-torso');
    this.neck = mesh(geometry.joint, 'anonymous-neck'); this.neck.scale.set(.075, .12, .08);
    for (let i = 0; i < 2; i++) {
      const side = i ? 'right' : 'left';
      this.legs.push(new SoftLimb(geometry.legSkin, material, `remote-${side}-leg`, `remote-${side}-shin`));
      this.feet.push(mesh(geometry.joint, `remote-${side}-foot`)); this.feet[i].scale.set(.078, .052, .12);
      this.arms.push(new SoftLimb(geometry.armSkin, material, `remote-${side}-arm`, `remote-${side}-elbow`));
      this.group.add(this.legs[i].mesh, this.arms[i].mesh);
      this.hands.push(mesh(i ? geometry.rightHand : geometry.leftHand, `remote-${side}-hand`));
      this.hands[i].scale.setScalar(.88);
    }
  }
  update(layout: AvatarLayout, pitch: number): void {
    this.head.position.copy(layout.head.center); this.head.quaternion.copy(layout.head.rotation); this.head.rotateX(pitch);
    this.torso.position.copy(layout.torso.center); this.torso.quaternion.copy(layout.torso.rotation); this.torso.scale.set(1, layout.torso.height / .88, .7);
    this.neck.position.copy(layout.head.center); this.neck.position.y -= .21;
    for (let i = 0; i < 2; i++) {
      this.legs[i].update(layout.hips[i], layout.knees[i], layout.ankles[i]); this.feet[i].position.copy(layout.feet[i].center);
      const shoulder = layout.shoulders[i], hand = layout.hands[i];
      this.arms[i].update(shoulder, layout.elbows[i], hand);
      this.hands[i].position.copy(hand); this.hands[i].rotation.copy(layout.weaponRotation);
    }
  }
  dispose(): void { for (const limb of [...this.legs, ...this.arms]) limb.dispose(); this.group.removeFromParent(); this.group.clear(); }
}

import { MathUtils, Vector3 } from 'three';
import { leanConfig, leanOffset } from '../../../../shared/Lean';
import { gameConfig } from '../config/gameConfig';
import { identityRotation, PhysicsWorld, RAPIER } from './PhysicsWorld';
import type { CharacterInput } from '../../../../shared/ShooterProtocol';

export class CharacterController {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly motorCollider: RAPIER.Collider;
  readonly motor: RAPIER.KinematicCharacterController;
  readonly previous = new Vector3();
  readonly current = new Vector3();
  readonly velocity = new Vector3();
  readonly acceleration = new Vector3();
  readonly spawn: Vector3;
  readonly position = new Vector3();
  lean = 0;
  grounded = false;
  crouching = false;
  sprinting = false;
  height = gameConfig.player.height;
  landingSpeed = 0;
  tookOff = false;
  private time = 0;
  private lastGrounded = -100;
  private lastJump = -100;
  private jumpRequestedAt = -100;
  private preStepVy = 0;
  private readonly oldVelocity = new Vector3();
  private readonly wish = new Vector3();
  private readonly drive = new Vector3();
  constructor(readonly physics: PhysicsWorld, readonly input: CharacterInput, spawn: Vector3) {
    const p = gameConfig.player;
    this.spawn = spawn.clone();
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y + p.height / 2, spawn.z).lockRotations().setCanSleep(false).setCcdEnabled(true));
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(p.height / 2 - p.radius, p.radius)
      .setMass(p.mass).setFriction(0).setRestitution(0), this.body);
    // A slightly inset sensor gives the sweep motor its skin while the outer dynamic
    // capsule remains in solver contact. This prevents overlapping-floor sweep jitter.
    this.motorCollider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(p.height / 2 - p.radius, p.radius - 0.025)
      .setSensor(true).setDensity(0), this.body);
    this.motor = physics.world.createCharacterController(0.015);
    this.motor.setSlideEnabled(true);
    // Only enable recursive autostep when a nearby tread needs it.
    this.motor.disableAutostep();
    this.motor.setMaxSlopeClimbAngle(MathUtils.degToRad(p.maxSlope));
    this.motor.setMinSlopeSlideAngle(MathUtils.degToRad(p.maxSlope + 3));
    this.current.copy(this.body.translation()); this.previous.copy(this.current);
    physics.world.updateSceneQueries();
  }
  private resizeCapsule(dt: number): void {
    const p = gameConfig.player, world = this.physics.world;
    const wantsCrouch = this.input.keys.has('ControlLeft') || this.input.keys.has('ControlRight');
    const pos = this.body.translation(), feet = pos.y - this.height / 2;
    // In flight, draw the knees up under the head instead of lowering the head.
    const airborneDuck = !this.grounded && this.time - this.lastJump < 1;
    // Test the entire expanded capsule, retaining a floor tolerance. Includes doors/cars/ceilings.
    const standingCenter = { x: pos.x, y: airborneDuck ? pos.y + (this.height - p.height) / 2 : feet + p.height / 2 + 0.025, z: pos.z };
    const blocked = !wantsCrouch && this.height < p.height - 0.001 && world.intersectionWithShape(
      standingCenter, identityRotation, new RAPIER.Capsule(p.height / 2 - p.radius, p.radius - 0.005),
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider, this.body);
    this.crouching = wantsCrouch || Boolean(blocked);
    const desired = this.crouching ? p.crouchHeight : p.height;
    const next = MathUtils.clamp(desired, this.height - (p.height - p.crouchHeight) * dt / p.crouchDuration,
      this.height + (p.height - p.crouchHeight) * dt / p.crouchDuration);
    if (Math.abs(next - this.height) < 1e-6) return;
    const shift = (next - this.height) / 2 * (airborneDuck ? -1 : 1);
    this.collider.setShape(new RAPIER.Capsule(next / 2 - p.radius, p.radius));
    this.motorCollider.setShape(new RAPIER.Capsule(next / 2 - p.radius, p.radius - 0.025));
    this.collider.setMass(p.mass);
    this.body.setTranslation({ x: pos.x, y: pos.y + shift, z: pos.z }, true);
    this.previous.y += shift; this.current.y += shift; this.height = next;
    world.updateSceneQueries();
  }
  beforeStep(dt: number, reloading: boolean): void {
    const p = gameConfig.player;
    this.landingSpeed = 0; this.tookOff = false;
    this.time += dt;
    if (this.input.consume('Space')) this.jumpRequestedAt = this.time;
    this.resizeCapsule(dt);
    this.previous.copy(this.current);
    const forward = this.input.forward, side = this.input.sideways;
    this.sprinting = this.input.keys.has('ShiftLeft') && forward > 0 && !this.crouching && !this.input.aiming && !reloading;
    const speed = (this.crouching ? p.crouchSpeed : this.sprinting ? p.sprintSpeed : p.walkSpeed) * (this.input.aiming ? p.adsSpeedMultiplier : 1);
    this.wish.set(side * Math.cos(this.input.yaw) - forward * Math.sin(this.input.yaw), 0,
      -forward * Math.cos(this.input.yaw) - side * Math.sin(this.input.yaw));
    if (this.wish.lengthSq() > 0) this.wish.clampLength(0, 1).multiplyScalar(speed);
    this.oldVelocity.copy(this.velocity);
    const live = this.body.linvel();
    this.velocity.set(live.x, live.y, live.z);
    const amount = (forward || side ? p.acceleration : p.deceleration) * (this.grounded ? 1 : p.airControl) * dt;
    if (this.grounded || forward || side) {
      const dx = this.wish.x - this.drive.x, dz = this.wish.z - this.drive.z;
      const factor = Math.min(1, amount / Math.max(0.0001, Math.hypot(dx, dz)));
      this.drive.x += dx * factor; this.drive.z += dz * factor;
    }
    const canStep = (this.grounded || this.time - this.lastGrounded < .14) && live.y <= 2 && this.time - this.lastJump > .18;
    const horizontal = { x: this.drive.x * dt, y: 0, z: this.drive.z * dt };
    // In open space a single sweep is sufficient; retain the full motor near
    // walls, slopes and stairs. Gravity/contact still use the rigid-body solver.
    const obstructed = (horizontal.x || horizontal.z) && this.physics.world.castShape(
      this.body.translation(), identityRotation, horizontal, this.motorCollider.shape,
      1, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider, this.body);
    let move = horizontal;
    if (obstructed) {
      let treadAhead = false;
      const length = Math.hypot(horizontal.x, horizontal.z);
      if (canStep && length > .001) {
        const origin = this.body.translation(), sample = {
          x: origin.x + horizontal.x / length * (p.radius + .08),
          y: origin.y - this.height / 2 + p.stepHeight + .025,
          z: origin.z + horizontal.z / length * (p.radius + .08),
        };
        const tread = this.physics.world.castRayAndGetNormal(new RAPIER.Ray(sample, { x: 0, y: -1, z: 0 }),
          p.stepHeight + .05, false, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider, this.body);
        const rise = tread ? sample.y - tread.toi + this.height / 2 - origin.y : 0;
        treadAhead = !!tread && tread.normal.y > Math.cos(MathUtils.degToRad(p.maxSlope)) && rise > .005;
      }
      if (treadAhead) this.motor.enableAutostep(p.stepHeight, .08, false);
      else this.motor.disableAutostep();
      this.motor.computeColliderMovement(this.motorCollider, { ...horizontal, y: treadAhead ? -.035 : 0 },
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, c => c.handle !== this.collider.handle);
      move = this.motor.computedMovement();
    }
    const desiredLength = Math.hypot(this.drive.x, this.drive.z) * dt;
    const actualLength = Math.hypot(live.x, live.z) * dt;
    if (canStep && desiredLength > .001 && (Math.hypot(move.x, move.z) < desiredLength * .95 || actualLength < desiredLength * .9)) {
      // Read the tread ahead with a downward ray. Capsule contact normals on a
      // sharp stair edge are diagonal, even when the tread itself is flat.
      const world = this.physics.world, origin = this.body.translation();
      const flags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
      const lookAhead = p.radius + .08;
      const dx = this.drive.x * dt, dz = this.drive.z * dt;
      const sample = { x: origin.x + dx / desiredLength * lookAhead,
        y: origin.y - this.height / 2 + p.stepHeight + .025, z: origin.z + dz / desiredLength * lookAhead };
      const tread = world.castRayAndGetNormal(new RAPIER.Ray(sample, { x: 0, y: -1, z: 0 }),
        p.stepHeight + .05, false, flags, undefined, this.collider, this.body);
      if (tread && tread.normal.y > Math.cos(MathUtils.degToRad(p.maxSlope))) {
        const rise = sample.y - tread.toi + this.height / 2 + .018 - origin.y;
        if (rise > .025 && rise <= p.stepHeight + .02) {
          const ceiling = world.castShape(origin, identityRotation, { x: 0, y: 1, z: 0 }, this.collider.shape,
            rise, false, flags, undefined, this.collider, this.body);
          const elevated = { x: origin.x, y: origin.y + rise, z: origin.z };
          const obstacle = world.castShape(elevated, identityRotation, { x: dx, y: 0, z: dz }, this.collider.shape,
            1, false, flags, undefined, this.collider, this.body);
          if (!ceiling && !obstacle) { move.x = dx; move.z = dz; move.y = rise; }
        }
      }
    }
    this.velocity.x = move.x / dt; this.velocity.z = move.z / dt;
    if (canStep && move.y > 0.001) {
      // The motor or bounded tread check resolves clearance before lifting the body.
      // Vertical falling/jumping remains the rigid-body solver's responsibility.
      const position = this.body.translation();
      this.body.setTranslation({ x: position.x, y: position.y + move.y, z: position.z }, true);
      this.velocity.y = Math.max(0, this.velocity.y);
    }
    if (this.time - this.jumpRequestedAt <= p.jumpBuffer && this.time - this.lastGrounded < p.coyoteTime && this.time - this.lastJump > 0.18) {
      this.velocity.y = Math.sqrt(2 * Math.abs(p.gravity) * p.jumpHeight);
      this.grounded = false; this.lastGrounded = -100; this.lastJump = this.time; this.jumpRequestedAt = -100; this.tookOff = true;
    }
    if (this.velocity.y > 0) {
      const ceiling = this.physics.world.castShape(this.body.translation(), identityRotation,
        { x: 0, y: 1, z: 0 }, this.collider.shape, this.velocity.y * dt + 0.02, false,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider, this.body);
      if (ceiling && ceiling.normal1.y < -.35) this.velocity.y = Math.min(this.velocity.y, Math.max(0, (ceiling.toi - 0.012) / dt));
    }
    this.body.setLinvel(this.velocity, true);
    this.preStepVy = this.velocity.y;
    this.acceleration.subVectors(this.velocity, this.oldVelocity).divideScalar(dt);
  }
  afterStep(): void {
    this.current.copy(this.body.translation());
    const wasGrounded = this.grounded;
    const velocity = this.body.linvel();
    this.velocity.copy(velocity);
    this.acceleration.subVectors(this.velocity, this.oldVelocity).divideScalar(gameConfig.physics.timestep);
    if (!this.grounded) { this.drive.x = velocity.x; this.drive.z = velocity.z; }
    const hit = this.physics.world.castShape(this.body.translation(), identityRotation, { x: 0, y: -1, z: 0 },
      new RAPIER.Capsule(this.height / 2 - gameConfig.player.radius, gameConfig.player.radius - 0.008),
      gameConfig.player.groundProbe, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider, this.body);
    this.grounded = Boolean(hit && Math.abs(hit.normal1.y) > Math.cos(MathUtils.degToRad(gameConfig.player.maxSlope)) && velocity.y < 0.4 && this.time - this.lastJump > 0.12);
    if (this.grounded) {
      this.lastGrounded = this.time;
      if (!wasGrounded && this.preStepVy < -1.2) this.landingSpeed = -this.preStepVy;
    }
    this.updateLean(gameConfig.physics.timestep);
    if (this.current.y < -30) this.respawn();
  }
  private updateLean(dt: number): void {
    const target = (Number(this.input.keys.has('KeyE')) - Number(this.input.keys.has('KeyQ'))) * leanConfig.distance;
    const desired = MathUtils.damp(this.lean, target, leanConfig.response, dt);
    if (Math.abs(desired) < 1e-6) { this.lean = 0; return; }
    const offset = leanOffset(desired, this.input.yaw);
    const origin = { x: this.current.x, y: this.current.y + this.height / 2 - .1, z: this.current.z };
    const hit = this.physics.world.castShape(origin, identityRotation, offset, new RAPIER.Ball(leanConfig.radius),
      1, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider, this.body);
    // Clamp immediately on obstruction, including when turning while already leaning.
    this.lean = desired * (hit ? Math.max(0, hit.toi - .025) : 1);
  }
  interpolate(alpha: number): Vector3 {
    this.position.lerpVectors(this.previous, this.current, alpha);
    this.position.y -= this.height / 2;
    return this.position;
  }
  stopHorizontal(): void {
    this.lean = 0; this.drive.set(0, 0, 0); this.acceleration.set(0, 0, 0);
    const y = this.body.linvel().y;
    this.body.setLinvel({ x: 0, y, z: 0 }, true); this.velocity.set(0, y, 0);
  }
  correct(position: { x: number; y: number; z: number }): void {
    this.body.setTranslation({ x: position.x, y: position.y + this.height / 2, z: position.z }, true);
    this.current.copy(this.body.translation()); this.previous.copy(this.current);
    this.physics.world.updateSceneQueries();
  }
  shift(delta: Vector3): void {
    this.body.setTranslation(this.current.clone().add(delta), true);
    this.current.add(delta); this.previous.add(delta);
    this.physics.world.updateSceneQueries();
  }
  dispose(): void {
    this.physics.world.removeCharacterController(this.motor);
    this.physics.world.removeRigidBody(this.body);
  }
  respawn(): void {
    this.lean = 0; this.body.setEnabled(true);
    this.height = gameConfig.player.height;
    this.collider.setShape(new RAPIER.Capsule(this.height / 2 - gameConfig.player.radius, gameConfig.player.radius));
    this.motorCollider.setShape(new RAPIER.Capsule(this.height / 2 - gameConfig.player.radius, gameConfig.player.radius - .025));
    this.collider.setMass(gameConfig.player.mass);
    this.crouching = this.sprinting = false; this.landingSpeed = 0; this.tookOff = false;
    this.lastGrounded = this.lastJump = this.jumpRequestedAt = -100; this.preStepVy = 0;
    this.body.setTranslation({ x: this.spawn.x, y: this.spawn.y + this.height / 2, z: this.spawn.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.current.copy(this.body.translation()); this.previous.copy(this.current);
    this.velocity.set(0, 0, 0); this.drive.set(0, 0, 0); this.acceleration.set(0, 0, 0); this.grounded = false;
    this.input.clear(); this.physics.world.updateSceneQueries();
  }
  get state(): string {
    if (!this.grounded) return 'AIRBORNE';
    if (this.crouching) return 'CROUCHING';
    if (this.sprinting && this.velocity.length() > 0.3) return 'SPRINTING';
    return this.velocity.length() > 0.2 ? 'WALKING' : 'STANDING';
  }
}

export function findSpawn(physics: PhysicsWorld, seed: { x: number; y: number; z: number } = gameConfig.player.spawn): Vector3 {
  const p = gameConfig.player, search = p.spawnSearch;
  const shape = new RAPIER.Capsule(p.height / 2 - p.radius, p.radius + 0.04);
  const offsets: [number, number][] = [[0, 0]];
  for (let radius = .8; radius <= search.radius; radius += .8) for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) offsets.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  for (const [dx, dz] of offsets) {
    const x = seed.x + dx, z = seed.z + dz;
    const origin = new Vector3(x, seed.y + search.floorTolerance, z);
    const hit = physics.ray(origin, new Vector3(0, -1, 0), search.floorTolerance * 2);
    if (!hit || hit.normal.y < 0.8) continue;
    const floor = origin.y - hit.toi;
    if (Math.abs(floor - seed.y) > search.floorTolerance) continue;
    const y = floor + search.clearance;
    if (physics.world.intersectionWithShape({ x, y: y + p.height / 2, z }, identityRotation, shape)) continue;
    let supported = true;
    for (const [ox, oz] of [[-0.35, 0], [0.35, 0], [0, -0.35], [0, 0.35]]) {
      const support = physics.ray(new Vector3(x + ox, y + 0.1, z + oz), new Vector3(0, -1, 0), 0.3);
      if (!support || support.normal.y < 0.7) supported = false;
    }
    if (supported) return new Vector3(x, y, z);
  }
  throw new Error('No safe floor found near the configured spawn. Adjust player.spawn in gameConfig.ts.');
}

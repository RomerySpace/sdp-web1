/** Damped scalar spring, integrated in bounded substeps for stable visual motion. */
export class Spring {
  value = 0;
  velocity = 0;
  update(target: number, dt: number, stiffness = 130, damping = 20): number {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.velocity += ((target - this.value) * stiffness - this.velocity * damping) * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  kick(velocity: number): void { this.velocity += velocity; }
  reset(): void { this.value = this.velocity = 0; }
}

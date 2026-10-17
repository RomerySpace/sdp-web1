import { CylinderGeometry, Mesh, MeshBasicMaterial, Vector3, type Scene } from 'three';
import { gameplayConfig } from '../../../../shared/GameplayConfig';

export class ShotTrails {
  private readonly geometry = new CylinderGeometry(.006, .006, 1, 5);
  private readonly trails: { mesh: Mesh<CylinderGeometry, MeshBasicMaterial>; start: Vector3; direction: Vector3; distance: number; age: number }[] = [];
  private next = 0;
  private readonly up = new Vector3(0, 1, 0);
  constructor(scene: Scene) {
    for (let i = 0; i < 32; i++) {
      const mesh = new Mesh(this.geometry, new MeshBasicMaterial({ color: 0xe9f5ff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      mesh.name = 'shot-tracer';
      mesh.visible = false; scene.add(mesh);
      this.trails.push({ mesh, start: new Vector3(), direction: new Vector3(), distance: 0, age: Infinity });
    }
  }
  emit(start: Vector3, end: Vector3): void {
    const trail = this.trails[this.next++ % this.trails.length];
    trail.start.copy(start); trail.direction.subVectors(end, start); trail.distance = trail.direction.length();
    if (trail.distance < .05) return;
    trail.direction.normalize(); trail.mesh.quaternion.setFromUnitVectors(this.up, trail.direction);
    trail.age = 0; trail.mesh.visible = true;
  }
  update(dt: number): void {
    const config = gameplayConfig.shots;
    for (const trail of this.trails) {
      trail.age += dt;
      const progress = trail.age / config.tracerDuration;
      trail.mesh.visible = progress < 1;
      if (!trail.mesh.visible) continue;
      const head = Math.min(trail.distance, Math.max(.15, progress * trail.distance));
      const length = Math.min(config.tracerLength, head);
      trail.mesh.position.copy(trail.start).addScaledVector(trail.direction, head - length / 2);
      trail.mesh.scale.set(1, length, 1);
      trail.mesh.material.opacity = config.tracerOpacity * (1 - progress);
    }
  }
  dispose(): void { this.geometry.dispose(); for (const trail of this.trails) { trail.mesh.material.dispose(); trail.mesh.removeFromParent(); } }
}

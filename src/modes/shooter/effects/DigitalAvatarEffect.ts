import { BoxGeometry, DynamicDrawUsage, Group, InstancedMesh, MeshStandardMaterial, Object3D, Vector3 } from 'three';
import { gameplayConfig } from '../../../../shared/GameplayConfig';
export class DigitalAvatarEffect {
  readonly coherence = { value: 1 }; readonly time = { value: 0 };
  private readonly geometry = new BoxGeometry(.028, .028, .028);
  private readonly fragmentMaterial = new MeshStandardMaterial({ color: '#dbeaf2', emissive: '#bbd8ed', emissiveIntensity: .25,
    roughness: .65, transparent: true, opacity: gameplayConfig.death.particleOpacity, depthWrite: false });
  readonly fragments = new InstancedMesh(this.geometry, this.fragmentMaterial, gameplayConfig.death.fragmentCount);
  private readonly sources: Vector3[] = []; private readonly drift: Vector3[] = [];
  private readonly dummy = new Object3D(); private readonly materials: MeshStandardMaterial[] = [];
  constructor(group: Group) {
    this.fragments.instanceMatrix.setUsage(DynamicDrawUsage); this.fragments.frustumCulled = false;
    this.fragments.visible = false; group.add(this.fragments);
    for (let i = 0; i < gameplayConfig.death.fragmentCount; i++) {
      const angle = i * 2.39996, radius = .08 + (i % 7) * .03;
      this.sources.push(new Vector3(Math.cos(angle) * radius, (i + .5) / gameplayConfig.death.fragmentCount * 1.8, Math.sin(angle) * radius));
      this.drift.push(new Vector3(Math.cos(angle) * (.2 + i % 3 * .1), .12 + i % 5 * .03, Math.sin(angle) * .35));
    }
  }
  material(base: MeshStandardMaterial): MeshStandardMaterial {
    const material = base.clone(); material.transparent = true;
    material.onBeforeCompile = shader => {
      shader.uniforms.digitalCoherence = this.coherence; shader.uniforms.digitalTime = this.time;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        varying vec3 digitalPosition; uniform float digitalCoherence; uniform float digitalTime;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 cell = floor(position * 18.0);
          float drift = sin(dot(cell, vec3(7.1, 13.7, 3.4)) + digitalTime * 3.0);
          transformed.xz += vec2(drift, -drift * .3) * (1.0 - digitalCoherence) * .06;
          digitalPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 digitalPosition; uniform float digitalCoherence; uniform float digitalTime;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 cell = floor(digitalPosition * 24.0);
          float mask = fract(sin(dot(cell, vec3(12.9898, 78.233, 31.7))) * 43758.5453);
          if (mask > digitalCoherence) discard;
          float scan = pow(.5 + .5 * sin(digitalPosition.y * 120.0 - digitalTime * 18.0), 12.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.86, .94, 1.0), scan * (1.0 - digitalCoherence) * .8);
          diffuseColor.a *= smoothstep(0.0, .35, digitalCoherence);`);
    };
    material.customProgramCacheKey = () => 'sdp-digital-avatar-v1'; this.materials.push(material); return material;
  }
  update(now: number, coherence: number, progress: number, reconstructing: boolean, height: number): void {
    this.time.value = now / 1000; this.coherence.value = Math.max(0, Math.min(1, coherence));
    this.fragments.visible = progress > 0 && progress < 1;
    if (!this.fragments.visible) return;
    const scatter = reconstructing ? 1 - progress : progress;
    for (let i = 0; i < this.sources.length; i++) {
      this.dummy.position.copy(this.sources[i]); this.dummy.position.y *= height / 1.8;
      this.dummy.position.addScaledVector(this.drift[i], scatter * .9);
      this.dummy.rotation.set(i + scatter * .3, i * .7, i * .13);
      const scale = reconstructing ? Math.sin(progress * Math.PI) : Math.sin(Math.min(1, progress * 1.25) * Math.PI);
      this.dummy.scale.setScalar(Math.max(0, scale)); this.dummy.updateMatrix(); this.fragments.setMatrixAt(i, this.dummy.matrix);
    }
    this.fragments.instanceMatrix.needsUpdate = true;
  }
  dispose(): void { this.fragments.removeFromParent(); this.fragments.dispose(); this.materials.forEach(material => material.dispose()); this.geometry.dispose(); this.fragmentMaterial.dispose(); }
}

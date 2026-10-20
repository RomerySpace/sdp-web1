import { InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial, type Scene } from 'three';
import { lobbyAmbience } from '../core/LobbyAmbience';
import { lobbyRetreat } from '../../shared/LobbyRetreat';

/** One draw call; seeded drift and individual breathing lights run entirely on the GPU. */
export class TreeFireflies {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  constructor(scene: Scene) {
    const c = lobbyAmbience.fireflies, plane = new PlaneGeometry(1, 1);
    const geometry = new InstancedBufferGeometry();
    geometry.index = plane.index; geometry.setAttribute('position', plane.attributes.position); geometry.setAttribute('uv', plane.attributes.uv);
    const count = matchMedia('(pointer: coarse)').matches ? c.mobileCount : c.count;
    const seeds = new Float32Array(count * 4);
    let seed = 7173;
    for (let i = 0; i < seeds.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; seeds[i] = seed / 4294967296; }
    geometry.setAttribute('seed', new InstancedBufferAttribute(seeds, 4)); geometry.instanceCount = count;
    const material = new ShaderMaterial({ transparent: true, depthWrite: false, toneMapped: false,
      uniforms: { time: { value: 0 }, reveal: { value: 0 } },
      vertexShader: `
        attribute vec4 seed;
        uniform float time;
        varying vec2 vUv;
        varying float brightness;
        void main() {
          float phase = seed.w * 6.283185;
          float t = time * (.16 + seed.z * .12);
          float angle = seed.x * 6.283185 + sin(t * .37 + phase) * .24;
          float radius = .9 + sqrt(seed.y) * ${c.radius.toFixed(2)};
          vec3 center = vec3(cos(angle) * radius, .6 + seed.z * ${c.height.toFixed(2)}, sin(angle) * radius);
          center += vec3(sin(t + phase) * .45, sin(t * .7 + phase) * .3, cos(t * .8 + phase) * .45);
          vec4 view = modelViewMatrix * vec4(center, 1.);
          brightness = pow(.5 + .5 * sin(time * (.6 + seed.y * .65) + phase), 2.);
          brightness *= 1. - smoothstep(22., 46., length(view.xyz));
          view.xy += position.xy * ${c.size.toFixed(3)} * (1. + seed.w * .8);
          gl_Position = projectionMatrix * view; vUv = uv;
        }`,
      fragmentShader: `
        uniform float reveal;
        varying vec2 vUv;
        varying float brightness;
        void main() {
          float r = length(vUv - .5) * 2.;
          float light = exp(-r * r * 16.) + .15 * exp(-r * r * 4.);
          float alpha = light * brightness * reveal * ${c.opacity.toFixed(2)} * (1. - smoothstep(.7, 1., r));
          if (alpha < .003) discard;
          gl_FragColor = vec4(.94, 1., .88, alpha);
        }`,
    });
    this.mesh = new Mesh(geometry, material); this.mesh.name = 'Listening tree / fireflies';
    this.mesh.position.set(lobbyRetreat.x, 0, lobbyRetreat.z); this.mesh.frustumCulled = false;
    this.mesh.visible = false; scene.add(this.mesh);
  }
  update(time: number, reveal: number, enabled: boolean): void {
    this.mesh.visible = enabled && reveal > .9;
    this.mesh.material.uniforms.time.value = time;
    this.mesh.material.uniforms.reveal.value = Math.max(0, (reveal - .9) * 10);
  }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

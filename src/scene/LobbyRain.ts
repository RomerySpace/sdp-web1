import { InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial, Vector3, type PerspectiveCamera, type Scene } from 'three';
import { lobbyAmbience } from '../core/LobbyAmbience';
import { rainIntensity } from './RainSchedule';

export class LobbyRain {
  readonly material: ShaderMaterial;
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly cameraRight = new Vector3();
  private envelope = 0;
  constructor(scene: Scene) {
    const c = lobbyAmbience.rain;
    const mobile = matchMedia('(pointer: coarse)').matches;
    const count = mobile ? c.mobileDrops : c.drops;
    const plane = new PlaneGeometry(1, 1), geometry = new InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.attributes.position);
    geometry.setAttribute('uv', plane.attributes.uv);
    // Stable seeds: geometry is allocated once, all drop motion happens on the GPU.
    const seeds = new Float32Array(count * 4);
    let seed = 934857;
    for (let i = 0; i < seeds.length; i++) { seed = Math.imul(seed, 1664525) + 1013904223 | 0; seeds[i] = (seed >>> 0) / 4294967296; }
    geometry.setAttribute('dropSeed', new InstancedBufferAttribute(seeds, 4)); geometry.instanceCount = count;
    this.material = new ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
      uniforms: { time: { value: 0 }, intensity: { value: 0 }, anchor: { value: new Vector3() }, right: { value: this.cameraRight } },
      vertexShader: `
        attribute vec4 dropSeed;
        uniform float time;
        uniform vec3 anchor;
        uniform vec3 right;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          float span = ${(c.radius * 2).toFixed(1)};
          float speed = ${c.fallSpeed.toFixed(2)} * (.8 + dropSeed.w * .4);
          vec3 world;
          world.x = mod(dropSeed.x * span + time * ${c.wind.toFixed(2)} - anchor.x + ${c.radius.toFixed(2)}, span) + anchor.x - ${c.radius.toFixed(2)};
          world.z = mod(dropSeed.z * span - anchor.z + ${c.radius.toFixed(2)}, span) + anchor.z - ${c.radius.toFixed(2)};
          world.y = mod(dropSeed.y * ${c.height.toFixed(2)} - time * speed, ${c.height.toFixed(2)});
          float distanceFade = 1.0 - smoothstep(${(c.radius * .6).toFixed(2)}, ${c.radius.toFixed(2)}, length(world.xz - anchor.xz));
          vFade = distanceFade * smoothstep(.08, .65, world.y);
          world += right * position.x * ${c.width.toFixed(3)};
          world.y += position.y * ${c.streakLength.toFixed(2)};
          world.x -= position.y * ${(.34 * c.wind / c.fallSpeed).toFixed(4)};
          vec4 view = viewMatrix * vec4(world, 1.0);
          vFade *= exp(-dot(view.xyz, view.xyz) * .0012);
          vUv = uv;
          gl_Position = projectionMatrix * view;
        }
      `,
      fragmentShader: `
        uniform float intensity;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          float width = 1.0 - smoothstep(.1, .5, abs(vUv.x - .5));
          float ends = smoothstep(0.0, .22, vUv.y) * (1.0 - smoothstep(.65, 1.0, vUv.y));
          gl_FragColor = vec4(.84, .91, .98, width * ends * vFade * intensity * ${c.opacity.toFixed(2)});
        }
      `,
    });
    this.mesh = new Mesh(geometry, this.material); this.mesh.name = 'Lobby atmospheric rain';
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 20; scene.add(this.mesh);
  }
  update(dt: number, time: number, reveal: number, camera: PerspectiveCamera, enabled: boolean, weatherTime = Date.now() / 1000): void {
    const target = enabled ? rainIntensity(weatherTime) * Math.max(0, (reveal - .95) / .05) : 0;
    this.envelope += (target - this.envelope) * (1 - Math.exp(-dt * 2));
    this.mesh.visible = enabled && this.envelope > .002;
    this.material.uniforms.intensity.value = this.envelope;
    this.material.uniforms.time.value = time;
    this.material.uniforms.anchor.value.copy(camera.position);
    camera.updateMatrixWorld(); this.cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
  }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.material.dispose(); }
}

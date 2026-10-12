import { DoubleSide, MeshPhysicalMaterial } from 'three';
import { gameConfig } from '../config/gameConfig';

export type StoneKind = 'wall' | 'floor' | 'cover' | 'vehicle';
/** Continuous 3D marble: no imported UV dependency, and no stretching between objects. */
export class MarbleMaterial {
  readonly uniforms = {
    stoneScale: { value: gameConfig.environment.marbleScale },
    veinStrength: { value: gameConfig.environment.veinStrength },
  };
  readonly materials = new Map<StoneKind, MeshPhysicalMaterial>();
  constructor() {
    const palette = { wall: '#F4F3EF', floor: '#E8EDF0', cover: '#F8F7F3', vehicle: '#DCE7ED' };
    for (const kind of Object.keys(palette) as StoneKind[]) {
      const material = new MeshPhysicalMaterial({
        color: palette[kind], roughness: gameConfig.environment.marbleRoughness,
        metalness: 0, clearcoat: kind === 'vehicle' ? 0.3 : 0.12, clearcoatRoughness: 0.32,
        side: DoubleSide,
      });
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, this.uniforms);
        shader.vertexShader = 'varying vec3 vStoneWorld;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
          'vStoneWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>');
        shader.fragmentShader = `
          varying vec3 vStoneWorld;
          uniform float stoneScale;
          uniform float veinStrength;
          float stoneHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
          float stoneNoise(vec3 p) {
            vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(stoneHash(i), stoneHash(i+vec3(1,0,0)), f.x),
                           mix(stoneHash(i+vec3(0,1,0)),stoneHash(i+vec3(1,1,0)),f.x),f.y),
                       mix(mix(stoneHash(i+vec3(0,0,1)),stoneHash(i+vec3(1,0,1)),f.x),
                           mix(stoneHash(i+vec3(0,1,1)),stoneHash(i+vec3(1,1,1)),f.x),f.y),f.z);
          }
        ` + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
          #include <color_fragment>
          vec3 stoneP = vStoneWorld * stoneScale;
          float broad = stoneNoise(stoneP * 0.72);
          float fine = stoneNoise(stoneP * 2.9 + broad * 2.3);
          float vein = pow(1.0 - abs(sin(stoneP.x * 2.6 + stoneP.z * 1.1 + stoneP.y * 0.7 + broad * 7.0 + fine * 1.2)), 14.0);
          float thread = pow(1.0 - abs(sin(stoneP.x * 5.1 + stoneP.z * 2.2 + broad * 13.0 + fine * 3.0)), 24.0);
          diffuseColor.rgb *= 0.975 + broad * 0.025;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.66, 0.70, 0.73), veinStrength * (vein + thread * 0.25));
        `);
        shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + (fine - 0.5) * 0.08, 0.15, 0.95);');
      };
      material.customProgramCacheKey = () => 'sdp-marble-world-v1';
      this.materials.set(kind, material);
    }
    this.update();
  }
  get(kind: StoneKind): MeshPhysicalMaterial { return this.materials.get(kind)!; }
  update(): void {
    const e = gameConfig.environment;
    this.uniforms.stoneScale.value = e.marbleScale;
    this.uniforms.veinStrength.value = e.veinStrength;
    this.materials.forEach((m, kind) => { m.roughness = Math.min(0.95, e.marbleRoughness + (kind === 'floor' ? 0.16 : kind === 'cover' ? 0.1 : kind === 'vehicle' ? -0.08 : 0)); });
  }
  dispose(): void { this.materials.forEach(m => m.dispose()); }
}

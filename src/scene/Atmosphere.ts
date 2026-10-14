import {
  FogExp2, Mesh, PlaneGeometry, Scene, ShaderMaterial, Vector3,
  type MeshStandardMaterial,
} from 'three';

/** One backdrop draw and a few operations in the existing material shaders.
 * No postprocessing buffers, particles, transparent fog stacks or sky photograph. */
export class Atmosphere {
  readonly horizon = { value: new Vector3(0.20, 0.23, 0.27) };
  private readonly uniforms = {
    atmosphereTime: { value: 0 }, atmosphereReveal: { value: 0 },
    atmosphereHorizon: this.horizon,
  };
  private readonly backdrop: Mesh<PlaneGeometry, ShaderMaterial>;

  constructor(scene: Scene) {
    scene.fog = new FogExp2(0x333b45, 0.035);
    this.backdrop = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform float atmosphereTime;
        uniform float atmosphereReveal;
        uniform vec3 atmosphereHorizon;
        varying vec2 vUv;
        void main() {
          vec2 p = vUv - 0.5;
          float drift = sin(p.x * 3.3 + atmosphereTime * 0.018)
                      * sin(p.y * 4.2 - atmosphereTime * 0.012);
          float veil = smoothstep(-0.35, 0.9, p.y + p.x * 0.16 + drift * 0.08);
          vec3 ivory = vec3(0.38, 0.42, 0.46);
          vec3 blue = vec3(0.20, 0.25, 0.31);
          vec3 color = mix(ivory, blue, veil * (0.37 + atmosphereReveal * 0.13));
          color += exp(-dot(p - vec2(-0.2, 0.12), p - vec2(-0.2, 0.12)) * 3.0) * 0.009;
          color = mix(atmosphereHorizon, color, smoothstep(0.0, 0.35, abs(p.y)));
          gl_FragColor = vec4(mix(vec3(1.0), color, atmosphereReveal), 1.0);
        }
      `,
    }));
    this.backdrop.frustumCulled = false;
    this.backdrop.renderOrder = -1000;
    scene.add(this.backdrop);
  }

  apply(material: MeshStandardMaterial): void {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nvarying vec3 vAtmospherePosition;')
        .replace('#include <project_vertex>', `
          #include <project_vertex>
          vec4 atmosphereVertex = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            atmosphereVertex = instanceMatrix * atmosphereVertex;
          #endif
          vAtmospherePosition = (modelMatrix * atmosphereVertex).xyz;
        `);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <fog_pars_fragment>', `
          #include <fog_pars_fragment>
          varying vec3 vAtmospherePosition;
          uniform float atmosphereTime;
          uniform float atmosphereReveal;
          uniform vec3 atmosphereHorizon;
        `)
        .replace('#include <fog_fragment>', `
          float opticalDistance = length(vAtmospherePosition - cameraPosition);
          float flow = sin(vAtmospherePosition.x * 0.055 + atmosphereTime * 0.025)
                     * sin(vAtmospherePosition.z * 0.045 - atmosphereTime * 0.018);
          float density = mix(0.148, 0.025, atmosphereReveal);
          float heightFalloff = 0.94 + 0.12 * exp(-max(vAtmospherePosition.y, 0.0) * 0.2);
          float haze = 1.0 - exp(-pow(opticalDistance * density, 2.0) * heightFalloff * (1.0 + flow * 0.12));
          vec3 hazeColor = mix(vec3(0.72, 0.74, 0.76), atmosphereHorizon,
                               smoothstep(18.0, 90.0, opticalDistance));
          haze = mix(1.0, haze, smoothstep(0.0, 0.3, atmosphereReveal));
          hazeColor = mix(vec3(1.0), hazeColor, atmosphereReveal);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeColor, clamp(haze, 0.0, 1.0));
        `);
    };
    material.customProgramCacheKey = () => 'sdp-atmosphere-v4';
  }

  update(time: number, reveal: number): void {
    this.uniforms.atmosphereTime.value = time;
    this.uniforms.atmosphereReveal.value = reveal;
  }

  dispose(): void { this.backdrop.geometry.dispose(); this.backdrop.material.dispose(); }
}

import {
  FogExp2, Matrix4, Mesh, PlaneGeometry, Scene, ShaderMaterial, Vector3,
  type PerspectiveCamera,
  type MeshStandardMaterial,
} from 'three';
import { galleryImmersion } from '../../shared/LowerGallery';

/** One backdrop draw and a few operations in the existing material shaders.
 * No postprocessing buffers, particles, transparent fog stacks or sky photograph. */
export class Atmosphere {
  readonly horizon = { value: new Vector3(0.20, 0.23, 0.27) };
  private readonly uniforms = {
    atmosphereTime: { value: 0 }, atmosphereReveal: { value: 0 },
    atmosphereHorizon: this.horizon,
    atmosphereInterior: { value: 0 },
    atmosphereNight: { value: 0 },
  };
  private readonly backdrop: Mesh<PlaneGeometry, ShaderMaterial>;

  constructor(scene: Scene) {
    scene.fog = new FogExp2(0x333b45, 0.035);
    this.backdrop = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: `
        uniform mat4 skyInverseProjection;
        uniform mat4 skyCameraWorld;
        varying vec3 vWorldDirection;
        void main() {
          vec4 direction = skyInverseProjection * vec4(position.xy, 1.0, 1.0);
          vWorldDirection = mat3(skyCameraWorld) * direction.xyz;
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform float atmosphereReveal;
        uniform float atmosphereNight;
        uniform vec3 atmosphereHorizon;
        varying vec3 vWorldDirection;
        void main() {
          float elevation = normalize(vWorldDirection).y;
          vec3 color = mix(atmosphereHorizon, vec3(.38, .42, .46), smoothstep(-.035, .68, elevation));
          color = mix(color, vec3(.29, .34, .40), smoothstep(.62, 1.0, elevation) * .3);
          vec3 nightSky = mix(vec3(.045, .052, .057), vec3(.018, .023, .027), smoothstep(-.04, .7, elevation));
          color = mix(color, nightSky, atmosphereNight);
          gl_FragColor = vec4(mix(vec3(1.0), color, atmosphereReveal), 1.0);
        }
      `,
    }));
    this.backdrop.material.uniforms.skyInverseProjection = { value: new Matrix4() };
    this.backdrop.material.uniforms.skyCameraWorld = { value: new Matrix4() };
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
          uniform float atmosphereInterior;
          uniform float atmosphereNight;
        `)
        .replace('#include <fog_fragment>', `
          float opticalDistance = length(vAtmospherePosition - cameraPosition);
          float flow = sin(vAtmospherePosition.x * 0.055 + atmosphereTime * 0.025)
                     * sin(vAtmospherePosition.z * 0.045 - atmosphereTime * 0.018);
          float density = mix(0.148, 0.025, atmosphereReveal);
          density *= mix(1.0, .20, atmosphereInterior);
          float heightFalloff = 0.94 + 0.12 * exp(-max(vAtmospherePosition.y, 0.0) * 0.2);
          float haze = 1.0 - exp(-pow(opticalDistance * density, 2.0) * heightFalloff * (1.0 + flow * 0.12));
          vec3 hazeColor = mix(vec3(0.72, 0.74, 0.76), atmosphereHorizon,
                               smoothstep(18.0, 90.0, opticalDistance));
          hazeColor = mix(hazeColor, vec3(.045, .052, .057), atmosphereNight);
          gl_FragColor.rgb *= mix(1.0, .52, atmosphereNight);
          haze = mix(1.0, haze, smoothstep(0.0, 0.3, atmosphereReveal));
          hazeColor = mix(vec3(1.0), hazeColor, atmosphereReveal);
          hazeColor = mix(hazeColor, vec3(.94, .96, .97), atmosphereInterior);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeColor, clamp(haze, 0.0, 1.0));
        `);
    };
    material.customProgramCacheKey = () => 'sdp-atmosphere-v5';
  }

  update(time: number, reveal: number, camera?: PerspectiveCamera, night = 0): void {
    this.uniforms.atmosphereTime.value = time;
    this.uniforms.atmosphereReveal.value = reveal;
    this.uniforms.atmosphereNight.value = night;
    if (camera) {
      this.uniforms.atmosphereInterior.value = galleryImmersion(camera.position.x, camera.position.y, camera.position.z);
      camera.updateMatrixWorld();
      this.backdrop.material.uniforms.skyInverseProjection.value.copy(camera.projectionMatrixInverse);
      this.backdrop.material.uniforms.skyCameraWorld.value.copy(camera.matrixWorld);
    }
  }

  dispose(): void { this.backdrop.geometry.dispose(); this.backdrop.material.dispose(); }
}

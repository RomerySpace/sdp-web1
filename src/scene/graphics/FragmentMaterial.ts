import { Color, ShaderMaterial, UniformsLib, UniformsUtils } from 'three';

export class FragmentMaterial {
  readonly lines = this.create(false);
  readonly points = this.create(true);

  private create(points: boolean): ShaderMaterial {
    return new ShaderMaterial({
      name: points ? 'Digital fragment points' : 'Digital fragment contours',
      defines: points ? { FRAGMENT_POINTS: 1 } : {},
      uniforms: UniformsUtils.merge([UniformsLib.fog, {
        uColor: { value: new Color(points ? '#B8CDD8' : '#A9C7D7') },
        uTime: { value: 0 }, uProgress: { value: 0 }, uOpacity: { value: 0 },
        uDepthStrength: { value: 0.8 }, uDensity: { value: 1 }, uPhase: { value: 0 },
        uDriftSpeed: { value: 0.12 }, uPixelRatio: { value: 1 },
      }]),
      transparent: true,
      depthTest: true,
      depthWrite: false,
      fog: true,
      toneMapped: false,
      vertexShader: `
        #include <fog_pars_vertex>
        attribute float aSeed;
        attribute float aReveal;
        attribute float aWeight;
        uniform float uTime;
        uniform float uProgress;
        uniform float uDepthStrength;
        uniform float uPhase;
        uniform float uDriftSpeed;
        uniform float uPixelRatio;
        varying float vPresence;
        varying float vSeed;
        void main() {
          float assembled = smoothstep(aReveal, aReveal + 0.14, uProgress);
          float phase = aSeed * 31.0 + uPhase;
          vec3 transformed = position;
          transformed.z *= uDepthStrength;
          transformed += vec3(sin(phase), cos(phase * 1.7), sin(phase * 0.6))
                       * (1.0 - assembled) * 0.035;
          float time = uTime * uDriftSpeed;
          transformed.z += sin(time + phase) * 0.0025;
          #ifdef FRAGMENT_POINTS
            transformed.y += sin(time * 0.7 + phase * 1.3) * 0.002;
          #endif
          vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #ifdef FRAGMENT_POINTS
            gl_PointSize = 1.6 * uPixelRatio * clamp(8.0 / max(-mvPosition.z, 0.1), 0.55, 1.65);
          #endif
          vPresence = assembled * (0.55 + aWeight * 0.45)
                    * (0.975 + sin(time * 1.2 + phase) * 0.025);
          vSeed = aSeed;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        #include <fog_pars_fragment>
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uDensity;
        varying float vPresence;
        varying float vSeed;
        void main() {
          if (vSeed >= uDensity || vPresence < 0.005) discard;
          float alpha = uOpacity * vPresence;
          #ifdef FRAGMENT_POINTS
            float radius = length(gl_PointCoord - 0.5);
            alpha *= 1.0 - smoothstep(0.25, 0.5, radius);
          #endif
          gl_FragColor = vec4(uColor, alpha);
          #include <fog_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
  }

  dispose(): void { this.lines.dispose(); this.points.dispose(); }
}

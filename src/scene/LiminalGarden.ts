import { BufferGeometry, DoubleSide, Float32BufferAttribute, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, Vector2, type Vector3, type Material, type Scene } from 'three';
import { createUpperMonolithGeometry, monolithFinish } from './MonolithGeometry';
import type { Atmosphere } from './Atmosphere';
import { lobbyAmbience } from '../core/LobbyAmbience';
import { lobbyRetreat, lobbyBenches } from '../../shared/LobbyRetreat';
import { ambientStation } from '../../shared/AmbientStation';

/** Instanced tapered blades and a satin column; no external assets. */
export class LiminalGarden {
  private readonly reveal = { value: 0 };
  private readonly time = { value: 0 };
  private readonly center = { value: new Vector2() };
  private readonly objects: Mesh[] = [];
  constructor(scene: Scene, atmosphere: Atmosphere) {
    // The weapon floats between 1.33 and 2.28m. Leave the entire aperture clear.
    const finish = new MeshStandardMaterial(monolithFinish); atmosphere.apply(finish);
    finish.transparent = true; finish.depthWrite = false;
    const columnAtmosphere = finish.onBeforeCompile.bind(finish);
    finish.onBeforeCompile = (shader, renderer) => {
      columnAtmosphere(shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `
        #include <dithering_fragment>
        gl_FragColor.a *= 1.0 - smoothstep(${lobbyAmbience.monolith.fadeStart.toFixed(1)}, ${lobbyAmbience.monolith.fadeEnd.toFixed(1)}, vAtmospherePosition.y);
      `);
    };
    finish.customProgramCacheKey = () => 'sdp-monolith-zenith-v1';
    const tower = new Mesh(createUpperMonolithGeometry(), finish); tower.position.y = 2.85;
    tower.receiveShadow = true;
    tower.name = 'Nebula / infinite upper monolith';
    this.objects.push(tower);

    const geometry = new BufferGeometry(), vertices: number[] = [], indices: number[] = [];
    for (let i=0;i<=5;i++) {
      const t=i/5, width=.012*Math.pow(1-t,.7);
      vertices.push(-width+t*t*.13,t,0, width+t*t*.13,t,0);
      if(i<5) { const j=i*2; indices.push(j,j+1,j+2,j+1,j+3,j+2); }
    }
    geometry.setAttribute('position',new Float32BufferAttribute(vertices,3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    // Two camera-following fields wrap only beyond the visible ground. The far field
    // keeps the horizon covered without drawing the same density for hundreds of metres.
    for (const [span, count, distant] of [[64, 128000, 0], [200, 64000, 1]]) {
      const grass = new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: .08, roughness: .92, side: DoubleSide });
      atmosphere.apply(grass); const grassAtmosphere = grass.onBeforeCompile.bind(grass);
      grass.onBeforeCompile = (shader, renderer) => {
        grassAtmosphere(shader, renderer);
        Object.assign(shader.uniforms, { gardenTime: this.time, gardenCenter: this.center });
        shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
          uniform float gardenTime; uniform vec2 gardenCenter; varying float bladeHeight;`);
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          bladeHeight = position.y;
          vec3 stem = instanceMatrix[3].xyz;
          vec2 wrapped = mod(stem.xz - gardenCenter + ${span / 2}., ${span}.) - ${span / 2}. + gardenCenter;
          float distanceFromViewer = length(wrapped - gardenCenter);
          float edge = max(abs(wrapped.x), abs(wrapped.y));
          float root = smoothstep(.94, 1.28, edge + .035 * sin(wrapped.x * 13. + wrapped.y * 9.));
          vec2 instrumentEdge = abs(wrapped - vec2(${ambientStation.x.toFixed(2)}, ${ambientStation.z.toFixed(2)})) - vec2(${(ambientStation.width / 2).toFixed(2)}, ${(ambientStation.depth / 2).toFixed(2)});
          root *= smoothstep(-.04, .10, max(instrumentEdge.x, instrumentEdge.y));
          float fieldFade = ${distant ? 'smoothstep(21., 30., distanceFromViewer)' : '1. - smoothstep(26., 32., distanceFromViewer)'};
          ${lobbyBenches.map((seat, i) => `
          vec2 seatOffset${i} = wrapped - vec2(${seat.x.toFixed(2)}, ${seat.z.toFixed(2)});
          vec2 seatLocal${i} = vec2(${Math.cos(seat.yaw).toFixed(5)} * seatOffset${i}.x - ${Math.sin(seat.yaw).toFixed(5)} * seatOffset${i}.y,
            ${Math.sin(seat.yaw).toFixed(5)} * seatOffset${i}.x + ${Math.cos(seat.yaw).toFixed(5)} * seatOffset${i}.y);
          vec2 seatEdge${i} = abs(seatLocal${i}) - vec2(${(lobbyRetreat.seatWidth / 2).toFixed(3)}, ${(lobbyRetreat.seatDepth / 2).toFixed(3)});
          root *= smoothstep(-.04, .10, max(seatEdge${i}.x, seatEdge${i}.y));`).join('')}
          transformed *= root * fieldFade;
          float wave = sin(wrapped.x * .6 + wrapped.y * .35 + gardenTime * 1.4) + .35 * sin(wrapped.y * 1.8 - gardenTime * 2.1);
          transformed.x += wave * .11 * position.y * position.y * root * fieldFade;
          transformed.z += cos(wrapped.x * .8 + gardenTime) * .04 * position.y * position.y * root * fieldFade;`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float bladeHeight;')
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(.78, 1., smoothstep(0., .65, bladeHeight));');
        // Apply the same world-space wrap to projection and atmospheric fog.
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
          vec4 mvPosition = instanceMatrix * vec4(transformed, 1.);
          mvPosition.xz += wrapped - stem.xz;
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;`);
        shader.vertexShader = shader.vertexShader.replace('vAtmospherePosition = (modelMatrix * atmosphereVertex).xyz;',
          'atmosphereVertex.xz += wrapped - stem.xz; vAtmospherePosition = (modelMatrix * atmosphereVertex).xyz;');
      };
      grass.customProgramCacheKey = () => `sdp-white-grass-tree-retreat-v6-${span}`;
      const blades = new InstancedMesh(geometry, grass, count), dummy = new Object3D();
      let seed = 83; const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      for (let i = 0; i < blades.count; i++) {
        dummy.position.set((random() - .5) * span, .002, (random() - .5) * span);
        dummy.rotation.y = random() * Math.PI * 2;
        dummy.scale.set(distant ? 2.4 : .7 + random() * .8, .22 + Math.pow(random(), 2) * .38, 1);
        dummy.updateMatrix(); blades.setMatrixAt(i, dummy.matrix);
      }
      blades.name = distant ? 'White grass / horizon' : 'White grass / wind';
      blades.instanceMatrix.needsUpdate = true;
      // Positions are wrapped in the vertex shader; CPU bounds cannot cull them.
      blades.frustumCulled = false;
      this.objects.push(blades);
    }
    scene.add(...this.objects);
  }
  update(time: number, reveal: number, camera: Vector3): void {
    this.time.value = time; this.reveal.value = reveal; this.center.value.set(camera.x, camera.z);
  }
  dispose(): void { const materials=new Set<Material>(); for(const object of this.objects) { object.removeFromParent(); object.geometry.dispose(); materials.add(object.material as Material); if (object instanceof InstancedMesh) object.dispose(); } for(const material of materials) material.dispose(); }
}

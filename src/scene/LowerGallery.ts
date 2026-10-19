import { CanvasTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, BoxGeometry, BufferGeometry, Shape, ShapeGeometry, ExtrudeGeometry, DoubleSide, SRGBColorSpace, SpotLight, PointLight, Vector2, LinearMipmapLinearFilter, type Camera, type Material } from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { lowerGallery as g, galleryOutline, galleryStairWidth, galleryStairHeight, galleryImmersion, onGalleryStairs } from '../../shared/LowerGallery';
import { GalleryFilm } from './GalleryFilm';

export class LowerGallery {
  readonly group = new Group();
  readonly occluders: Mesh[] = [];
  readonly film: GalleryFilm;
  private readonly materials = new Set<Material>();
  private readonly textures: CanvasTexture[] = [];
  private readonly reflection: Reflector;
  constructor() {
    this.group.name = 'Limbo / lower gallery';
    const wall = new MeshStandardMaterial({ color: 0x343737, roughness: .92, envMapIntensity: .08, emissive: 0xffffff, emissiveIntensity: .004, fog: false });
    const entranceWall = new MeshStandardMaterial({ color: 0xe5e8e7, roughness: .88, fog: false });
    const floor = new MeshStandardMaterial({ color: 0x090a0a, roughness: .82, envMapIntensity: .04, fog: false });
    const seam = new MeshBasicMaterial({ color: 0x1b201f, fog: false });
    const light = new MeshBasicMaterial({ color: 0x939e9d, toneMapped: false, fog: false });
    const trim = new MeshStandardMaterial({ color: 0xd6dcdf, roughness: .58, metalness: .2, fog: false });
    const stairEdge = new MeshBasicMaterial({ color: 0xafbac2, fog: false });
    for (const material of [wall, entranceWall, floor, seam, light, trim, stairEdge]) this.materials.add(material);
    const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, material: Material, occludes = true) => {
      const mesh = new Mesh(new BoxGeometry(w, h, d), material); mesh.name = name; mesh.position.set(x, y, z);
      mesh.receiveShadow = true; this.group.add(mesh); if (occludes) this.occluders.push(mesh); return mesh;
    };
    const roomHeight = g.ceilingY - g.floorY;
    // Buried faces must not share the outdoor ground's y=0 depth plane.
    const buriedTop = -.08;
    const outline = galleryOutline(), shape = new Shape();
    outline.forEach((p, i) => { if (i === 0) shape.moveTo(p.x, -p.z); else shape.lineTo(p.x, -p.z); }); shape.closePath();
    const floorShape = new Shape();
    outline.forEach((p, i) => {
      if (i === 0) floorShape.moveTo(p.x, -p.z); else floorShape.lineTo(p.x, -p.z);
      if (p.x > 11.99 && p.z < -g.entranceHalfWidth + .001) {
        floorShape.lineTo(g.stairBottom + g.tread, galleryStairWidth(g.stairBottom + g.tread));
        floorShape.lineTo(g.stairBottom + g.tread, -galleryStairWidth(g.stairBottom + g.tread));
      }
    }); floorShape.closePath();
    const ground = new Mesh(new ExtrudeGeometry(floorShape, { depth: .18, bevelEnabled: false }), floor); ground.rotation.x = -Math.PI / 2; ground.position.y = g.floorY - .18;
    ground.name = 'Gallery / seamless curved mineral floor'; this.group.add(ground); this.occluders.push(ground);
    this.reflection = this.createReflection(floorShape); this.group.add(this.reflection);
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      if (a.x > 11.99 && b.x > 11.99 && Math.max(Math.abs(a.z), Math.abs(b.z)) <= g.entranceHalfWidth + .001) continue;
      const length = Math.hypot(b.x - a.x, b.z - a.z), angle = -Math.atan2(b.z - a.z, b.x - a.x);
      const panel = box('Gallery / continuous curved wall', length + .012, roomHeight, .18, (a.x + b.x) / 2, g.floorY + roomHeight / 2, (a.z + b.z) / 2, wall);
      panel.rotation.y = angle;
      const reveal = box('Gallery / perimeter light reveal', length + .012, .045, .19, (a.x + b.x) / 2, g.ceilingY - .18, (a.z + b.z) / 2, light, false); reveal.rotation.y = angle;
    }
    for (const side of [-1, 1]) {
      box('Gallery / upper stair side', g.stairTop - g.flareStart, 7.2 + buriedTop, .3, (g.stairTop + g.flareStart) / 2, (-7.2 + buriedTop) / 2, side * (g.stairHalfWidth + .15), wall);
      const dx = g.flareStart - g.stairBottom, dz = side * (g.stairHalfWidth - g.entranceHalfWidth);
      const flare = box('Gallery / flared stair wall', Math.hypot(dx, dz), 7.2 + buriedTop, .3, (g.flareStart + g.stairBottom) / 2, (-7.2 + buriedTop) / 2, side * ((g.stairHalfWidth + g.entranceHalfWidth) / 2 + .15), wall);
      flare.rotation.y = -Math.atan2(dz, dx);
      const mouthLength = g.stairTop - g.openStairStart, mouthX = (g.stairTop + g.openStairStart) / 2;
      box('Gallery / protected entrance side', mouthLength, .9 - buriedTop, .3, mouthX, (.9 + buriedTop) / 2, g.stairZ + side * (g.stairHalfWidth + .15), entranceWall);
      box('Gallery / entrance handrail', mouthLength, .035, .045, mouthX, .92, g.stairZ + side * (g.stairHalfWidth + .15), trim, false);
    }
    box('Gallery / protected entrance end', .3, 1.14, g.stairHalfWidth * 2 + .6, g.openStairStart, .33, g.stairZ, entranceWall);
    const ceilingMaterial = new MeshStandardMaterial({ color: 0x222624, roughness: 1, envMapIntensity: .05, side: DoubleSide, fog: false }); this.materials.add(ceilingMaterial);
    // The underside meets the room ceiling exactly, without an overlapping lintel.
    const roofShape = new Shape();
    roofShape.moveTo(g.stairBottom, -g.entranceHalfWidth - .3); roofShape.lineTo(g.flareStart, -g.stairHalfWidth - .3);
    roofShape.lineTo(g.openStairStart, -g.stairHalfWidth - .3); roofShape.lineTo(g.openStairStart, g.stairHalfWidth + .3);
    roofShape.lineTo(g.flareStart, g.stairHalfWidth + .3); roofShape.lineTo(g.stairBottom, g.entranceHalfWidth + .3); roofShape.closePath();
    const roof = new ExtrudeGeometry(roofShape, { depth: 1, bevelEnabled: false }), positions = roof.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const bottom = g.ceilingY + (positions.getX(i) - g.stairBottom) / (g.openStairStart - g.stairBottom) * (-.24 - g.ceilingY);
      positions.setZ(i, positions.getZ(i) > .5 ? buriedTop : bottom);
    }
    roof.rotateX(-Math.PI / 2); roof.computeVertexNormals();
    const roofGeometry = new BufferGeometry().copy(roof); roof.dispose();
    const soffit = new Mesh(roofGeometry, ceilingMaterial); soffit.name = 'Gallery / continuous sloped stair ceiling'; this.group.add(soffit); this.occluders.push(soffit);
    const ceiling = new Mesh(new ExtrudeGeometry(shape, { depth: buriedTop - g.ceilingY, bevelEnabled: false }), ceilingMaterial); ceiling.rotation.x = -Math.PI / 2; ceiling.position.y = g.ceilingY; ceiling.name = 'Gallery / continuous quiet ceiling'; this.group.add(ceiling); this.occluders.push(ceiling);
    const flightLength = g.flightSteps * g.tread;
    for (let flight = 0; flight < 2; flight++) for (let step = 0; step < g.flightSteps; step++) {
      if (flight === 1 && step === g.flightSteps - 1) continue;
      const start = g.stairTop - flight * (flightLength + g.landingLength) - step * g.tread;
      const x = start - g.tread / 2, top = galleryStairHeight(x), bottom = g.floorY - .18;
      box('Gallery / stair tread', g.tread, top - bottom, galleryStairWidth(start - g.tread) * 2, x, (top + bottom) / 2, g.stairZ, floor);
      box('Gallery / fine stair nosing', .018, .003, galleryStairWidth(start - g.tread) * 2 - .12, start - g.tread + .02, top + .003, g.stairZ, stairEdge, false);
    }
    box('Gallery / stair landing', g.landingLength, 3.78, galleryStairWidth(21 - g.landingLength / 2) * 2, 21, -5.49, g.stairZ, floor);

    const screen = new Mesh(new PlaneGeometry(g.film.width, g.film.height), new MeshBasicMaterial({ color: 0x101214, fog: false }));
    this.materials.add(screen.material); screen.name = 'Gallery / KENOSIS screen';
    screen.position.set(g.film.x, g.film.y, g.film.z); screen.rotation.y = Math.PI / 2;
    box('Gallery / screen shadow gap', .05, g.film.height + .08, g.film.width + .08, g.film.x - .04, g.film.y, g.film.z, seam, false);
    this.film = new GalleryFilm(aspect => {
      const width = Math.min(g.film.width, 4.8 * aspect); screen.scale.set(width / g.film.width, width / aspect / g.film.height, 1);
    });
    screen.material = this.film.material; this.group.add(screen);
    this.occluders.push(screen);
    const label = this.artworkLabel(); label.scale.setScalar(.7); label.position.set(-11.73, g.floorY + 1.45, -3.4); label.rotation.y = Math.PI / 2; this.group.add(label);
    this.exhibitionLighting();
    this.benchContactShadows();
    const direction = this.wayfinding(); direction.rotation.x = -Math.PI / 2; direction.rotation.z = -Math.PI / 2; direction.position.set(31.6, .012, g.stairZ); this.group.add(direction);
    // Reflect only the lower room, avoiding a second draw of the outdoor grass and sky.
    this.group.traverse(object => { if (object !== this.reflection) object.layers.enable(7); });
  }
  private createReflection(shape: Shape): Reflector {
    const resolution = matchMedia('(pointer: coarse)').matches ? 384 : 768;
    const reflector = new Reflector(new ShapeGeometry(shape), {
      textureWidth: resolution, textureHeight: resolution, multisample: 0, clipBias: .003,
      color: 0x090a0a,
      shader: { name: 'GallerySatinReflection',
        uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, blurStep: { value: new Vector2(.035, .035) }, blurBias: { value: Math.log2(resolution * .035) } },
        vertexShader: `
          uniform mat4 textureMatrix;
          varying vec4 vUv;
          #include <common>
          #include <logdepthbuf_pars_vertex>
          void main() {
            vUv = textureMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            #include <logdepthbuf_vertex>
          }
        `,
        fragmentShader: `
          uniform vec3 color;
          uniform sampler2D tDiffuse;
          uniform vec2 blurStep;
          uniform float blurBias;
          varying vec4 vUv;
          #include <logdepthbuf_pars_fragment>
          void main() {
            #include <logdepthbuf_fragment>
            vec2 uv = vUv.xy / vUv.w;
            vec3 reflected = vec3(0.0);
            for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) {
              float weight = (x == 0 ? .375 : .3125) * (y == 0 ? .375 : .3125);
              reflected += texture2D(tDiffuse, clamp(uv + vec2(float(x), float(y)) * blurStep, vec2(0.0), vec2(1.0)), blurBias).rgb * weight;
            }
            gl_FragColor = vec4(mix(color, reflected, .10), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        ` },
    });
    // Filter coarse mip levels before mixing: retain light spill, not a readable video image.
    const reflectionTexture = reflector.getRenderTarget().texture;
    reflectionTexture.generateMipmaps = true;
    reflectionTexture.minFilter = LinearMipmapLinearFilter;
    reflector.name = 'Gallery / satin floor reflection'; reflector.rotation.x = -Math.PI / 2;
    reflector.position.y = g.floorY + .002; reflector.camera.layers.set(7); reflector.visible = false;
    return reflector;
  }
  private exhibitionLighting(): void {
    const fixtureMaterial = new MeshStandardMaterial({ color: 0x242927, roughness: .6, metalness: .45, fog: false });
    this.materials.add(fixtureMaterial);
    for (const z of [-3.5, 1.2]) {
      const spot = new SpotLight(0xf5f5ed, 95, 11, Math.PI / 5, .95, 2);
      spot.position.set(-8.5, g.ceilingY - .26, z); spot.target.position.set(-11.9, -5.1, z);
      const fixture = new Mesh(new BoxGeometry(.22, .12, .34), fixtureMaterial);
      fixture.position.copy(spot.position); fixture.name = 'Gallery / recessed exhibition light';
      this.group.add(spot, spot.target, fixture);
    }
    const screenGlow = new PointLight(0xdce9ed, 9, 6, 2);
    screenGlow.position.set(g.film.x + .4, g.film.y, g.film.z); this.group.add(screenGlow);
    const seatingLight = new SpotLight(0xe9efed, 65, 10, Math.PI / 2.7, 1, 2);
    seatingLight.position.set(1, g.ceilingY - .15, 0); seatingLight.target.position.set(1, g.floorY, 0);
    this.group.add(seatingLight, seatingLight.target);
  }
  private artworkLabel(): Mesh {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1408;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ecf0ed'; ctx.font = '500 90px Helvetica, Arial, sans-serif'; ctx.fillText('Kenosis', 72, 145);
    ctx.font = '30px Helvetica, Arial, sans-serif'; ctx.fillStyle = '#b7c2be'; ctx.fillText('2026', 76, 207);
    ctx.fillStyle = '#d3dcd7'; ctx.font = '500 35px Helvetica, Arial, sans-serif'; ctx.fillText('Fitnesss & Riusforza', 76, 325); ctx.fillText('Sónar+D', 76, 378);
    const paragraphs = [
      'Registro audiovisual de la actuación en directo de Fitnesss & Riusforza en Sónar+D.',
      'Dirección creativa, producción audiovisual y cinematografía: Codec.',
      'Realizado junto a Álvaro Metzker e Ian Velasquez.',
      'Prótesis escultóricas: All0yangel y Óscar Carretero Castro.',
    ];
    let y = 485; ctx.font = '30px Helvetica, Arial, sans-serif';
    for (const paragraph of paragraphs) {
      let line = '';
      for (const word of paragraph.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > 860 && line) { ctx.fillText(line, 76, y); y += 44; line = word; } else line = next;
      }
      if (line) { ctx.fillText(line, 76, y); y += 44; } y += 35;
    }
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.anisotropy = 4; this.textures.push(texture);
    const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, fog: false, toneMapped: false }); this.materials.add(material);
    const mesh = new Mesh(new PlaneGeometry(1.05, 1.44375), material); mesh.name = 'Gallery / Kenosis museum label';
    mesh.userData.artwork = { title: 'Kenosis', year: 2026, artists: 'Fitnesss & Riusforza', film: 'Codec', collaborators: ['Álvaro Metzker', 'Ian Velasquez'], prosthetics: ['All0yangel', 'Óscar Carretero Castro'] }; return mesh;
  }
  private benchContactShadows(): void {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!, gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(73,88,98,.18)'); gradient.addColorStop(.45, 'rgba(73,88,98,.10)'); gradient.addColorStop(1, 'rgba(73,88,98,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
    const texture = new CanvasTexture(canvas); this.textures.push(texture);
    const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, fog: false }); this.materials.add(material);
    for (const seat of g.benches) {
      const mesh = new Mesh(new PlaneGeometry(2.8, 1.3), material); mesh.name = 'Gallery / soft seat contact';
      mesh.rotation.set(-Math.PI / 2, 0, -seat.yaw); mesh.position.set(seat.x, g.floorY + .006, seat.z); this.group.add(mesh);
    }
  }
  private wayfinding(): Mesh {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 128;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#53636b'; ctx.font = '32px Helvetica, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('SDP   /   LOWER GALLERY   /   -01', 512, 77);
    const texture = new CanvasTexture(canvas); this.textures.push(texture);
    const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, fog: false }); this.materials.add(material);
    const mesh = new Mesh(new PlaneGeometry(4.8, .6), material); mesh.name = 'Gallery / entrance inscription'; return mesh;
  }
  update(camera: Camera, enabled: boolean, gameVolume: number): void {
    const p = camera.position, immersion = galleryImmersion(p.x, p.y, p.z);
    this.reflection.visible = enabled && immersion > .05 && p.y > g.floorY;
    const approaching = onGalleryStairs(p.x, p.z) && p.x < 28;
    this.film.update(enabled && (immersion > .05 || approaching), gameVolume * immersion);
  }
  dispose(): void {
    this.reflection.dispose();
    this.group.removeFromParent(); this.group.traverse(object => { if (object instanceof Mesh) object.geometry.dispose(); });
    this.materials.forEach(material => material.dispose()); this.textures.forEach(texture => texture.dispose()); this.film.dispose();
  }
}

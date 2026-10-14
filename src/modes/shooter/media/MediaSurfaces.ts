import { BoxGeometry, CanvasTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader, Vector3, VideoTexture, type Texture } from 'three';
import type { MapLoader } from '../world/MapLoader';
interface MediaSlot { id: string; zone: string; wall: string; kind: 'poster' | 'tv'; anchor: [number, number, number]; direction: [number, number, number]; size: [number, number]; image?: string; video?: string }
export class MediaSurfaces {
  readonly root = new Group();
  readonly placements: { id: string; position: number[]; normal: number[] }[] = [];
  private readonly textures = new Set<Texture>();
  private readonly videos: HTMLVideoElement[] = [];
  private readonly abort = new AbortController();
  private disposed = false;
  async load(map: MapLoader): Promise<void> {
    const response = await fetch('/ads/slots.json', { signal: this.abort.signal });
    if (!response.ok) return;
    const slots = await response.json() as MediaSlot[];
    for (const slot of slots) {
      if (this.disposed) return;
      const direction = new Vector3(...slot.direction).normalize();
      const hit = map.trace(new Vector3(...slot.anchor), direction, 24);
      if (!hit?.face || Math.abs(hit.face.normal.y) > .15 || hit.distance < 1) continue;
      const normal = hit.face.normal.clone(); if (normal.dot(direction) > 0) normal.negate();
      const right = new Vector3().crossVectors(new Vector3(0, 1, 0), normal).normalize();
      const [width, height] = slot.size;
      // Sample the interior as well as the edges so a poster cannot bridge an opening.
      const supported = [-1, -.5, 0, .5, 1].every(x => [-1, -.5, 0, .5, 1].every(y => {
        const origin = hit.point.clone().addScaledVector(right, x * width / 2).add(new Vector3(0, y * height / 2, 0)).addScaledVector(normal, .3);
        const corner = map.trace(origin, normal.clone().negate(), .5);
        return corner && Math.abs(corner.distance - .3) < .05;
      }));
      if (!supported) continue;
      const group = new Group(); group.name = `media:${slot.id}`;
      group.position.copy(hit.point).addScaledVector(normal, .035);
      group.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal);
      if (slot.kind === 'tv') {
        const frame = new Mesh(new BoxGeometry(width + .12, height + .12, .07), new MeshStandardMaterial({ color: 0x171d22, roughness: .65 }));
        frame.position.z = -.005; group.add(frame);
      }
      const placeholder = document.createElement('canvas'); placeholder.width=512; placeholder.height=Math.round(512 * height / width);
      const ctx=placeholder.getContext('2d')!; ctx.fillStyle=slot.kind === 'tv' ? '#151c23' : '#7a858d'; ctx.fillRect(0,0,placeholder.width,placeholder.height);
      ctx.fillStyle='#c5d3dd';ctx.textAlign='center';ctx.font='14px sans-serif';ctx.fillText(slot.kind === 'tv' ? 'SDP / NO SIGNAL' : `SDP / ${slot.zone.toUpperCase()}`,256,placeholder.height/2);
      const texture=new CanvasTexture(placeholder); texture.colorSpace=SRGBColorSpace; this.textures.add(texture);
      const material=new MeshBasicMaterial({ map:texture, toneMapped:false });
      const screen=new Mesh(new PlaneGeometry(width,height),material); screen.position.z=.04; group.add(screen); this.root.add(group);
      this.placements.push({ id:slot.id, position:group.position.toArray(), normal:normal.toArray() });
      if(slot.image) void new TextureLoader().loadAsync(slot.image).then(image=> {
        if(this.disposed) { image.dispose();return; } image.colorSpace=SRGBColorSpace;this.textures.add(image);material.map=image;material.needsUpdate=true;
        const aspect = image.image.width / image.image.height;
        const surfaceAspect = width / height;
        screen.scale.set(Math.min(1, aspect / surfaceAspect), Math.min(1, surfaceAspect / aspect), 1);
      }).catch(()=> {});
      if(slot.video) {
        const video=document.createElement('video');video.muted=true;video.loop=true;video.playsInline=true;video.crossOrigin='anonymous';video.preload='none';video.src=slot.video;
        video.addEventListener('playing',()=> { if(this.disposed)return; if(material.map instanceof VideoTexture)return;const texture=new VideoTexture(video);texture.colorSpace=SRGBColorSpace;this.textures.add(texture);material.map=texture;material.needsUpdate=true; },{signal:this.abort.signal});
        this.videos.push(video);void video.play().catch(()=>{});
      }
    }
  }
  setActive(active: boolean): void { for(const video of this.videos) if(active) void video.play().catch(()=>{}); else video.pause(); }
  dispose(): void {
    this.disposed=true;this.abort.abort();for(const video of this.videos){video.pause();video.removeAttribute('src');video.load();}
    this.root.traverse(object=> { if(object instanceof Mesh){object.geometry.dispose();(Array.isArray(object.material)?object.material:[object.material]).forEach(material=>material.dispose());} });
    for(const texture of this.textures)texture.dispose();this.root.removeFromParent();this.root.clear();
  }
}

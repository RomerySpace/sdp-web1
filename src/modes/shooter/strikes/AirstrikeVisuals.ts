import { BufferGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, InstancedMesh, LineBasicMaterial, LineSegments, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, RingGeometry, Scene, Vector3, BoxGeometry } from 'three';
import { airstrikeConfig, type AirstrikeFlight } from '../../../../shared/AirstrikeProtocol';
import { createAircraft } from './Aircraft';
import { strikePresentation } from './StrikePresentation';
interface FlightVisual { root: Group; plane: Group; missile: Group; marker: Group; ring: Mesh; burst: Mesh; fragments: InstancedMesh; id: string; impactSound: boolean; passSound: boolean }
const forward = new Vector3(0,0,-1);
export class AirstrikeVisuals {
  readonly root = new Group();
  private readonly pool: FlightVisual[] = [];
  private flights: readonly AirstrikeFlight[] = [];
  private readonly dummy = new Object3D();
  private readonly direction = new Vector3();
  private readonly position = new Vector3();
  constructor(scene: Scene, private readonly sound: (phase: 'flyover' | 'impact', point: Vector3) => void) {
    const prototype = createAircraft();
    const missileBody = new CylinderGeometry(.13,.17,1.05,12), missileNose = new ConeGeometry(.13,.42,12);
    const shell = new MeshStandardMaterial({color:0xe6eef1,roughness:.4,metalness:.45});
    const ringGeometry = new RingGeometry(.97,1,96);
    const fragmentGeometry = new BoxGeometry(.12,.055,.2);
    for(let i=0;i<airstrikeConfig.maxActive;i++) {
      const root=new Group(),plane=prototype.clone(true),missile=new Group(),marker=new Group();
      plane.scale.setScalar(strikePresentation.aircraftScale);missile.scale.setScalar(strikePresentation.missileScale);
      const body=new Mesh(missileBody,shell);body.rotation.x=Math.PI/2;missile.add(body);
      const nose=new Mesh(missileNose,shell);nose.rotation.x=-Math.PI/2;nose.position.z=-.72;missile.add(nose);
      const markerMaterial=new MeshBasicMaterial({color:0x7798a8,transparent:true,opacity:.7,side:DoubleSide,depthWrite:false});
      const target=new Mesh(ringGeometry,markerMaterial);target.rotation.x=-Math.PI/2;target.scale.setScalar(airstrikeConfig.radius);marker.add(target);
      const cross=new LineSegments(new BufferGeometry().setFromPoints([new Vector3(-.8,.02,0),new Vector3(.8,.02,0),new Vector3(0,.02,-.8),new Vector3(0,.02,.8)]),new LineBasicMaterial({color:0x8ba9b7}));marker.add(cross);
      const ring=new Mesh(ringGeometry,new MeshBasicMaterial({color:0xd8f4ff,transparent:true,side:DoubleSide,opacity:0,depthWrite:false}));ring.rotation.x=-Math.PI/2;
      const burst=new Mesh(new IcosahedronGeometry(1,1),new MeshBasicMaterial({color:0xf4fbff,transparent:true,opacity:0,depthWrite:false}));
      const fragments=new InstancedMesh(fragmentGeometry,new MeshStandardMaterial({color:0xeefaff,emissive:0xc5e9f7,emissiveIntensity:.32,roughness:.65,transparent:true,opacity:0,depthWrite:false}),airstrikeConfig.fragments);
      fragments.frustumCulled=false;
      root.add(plane,missile,marker,ring,burst,fragments);root.visible=false;this.root.add(root);
      this.pool.push({root,plane,missile,marker,ring,burst,fragments,id:'',impactSound:false,passSound:false});
    }
    this.root.name='SDP / synchronized airstrikes';scene.add(this.root);
  }
  receive(flights: readonly AirstrikeFlight[]): void { this.flights=flights; }
  update(now: number): void {
    for(const visual of this.pool) if(visual.id&&!this.flights.some(f=>f.id===visual.id)){visual.id='';visual.root.visible=false;}
    for(const flight of this.flights) {
      let visual=this.pool.find(v=>v.id===flight.id);
      if(!visual){visual=this.pool.find(v=>!v.id);if(!visual)continue;visual.id=flight.id;visual.impactSound=visual.passSound=false;}
      const v=visual,t=(now-flight.startedAt)/1000,release=(flight.releasedAt-flight.startedAt)/1000;
      v.root.visible=now<flight.finishedAt;
      this.direction.set(Math.cos(flight.heading),0,Math.sin(flight.heading));
      const travel=(t-release)*35;
      v.plane.position.set(flight.x+this.direction.x*travel,airstrikeConfig.altitude+.15*Math.sin(t*1.2),flight.z+this.direction.z*travel);
      v.plane.rotation.set(0,Math.atan2(-this.direction.x,-this.direction.z),.06*Math.sin((t-release)*.7));
      v.plane.visible=t>=0&&now<flight.finishedAt;
      v.marker.position.set(flight.x,flight.y+.05,flight.z);v.marker.visible=now<flight.impactAt;
      const marker=v.marker.children[0] as Mesh;marker.scale.setScalar(airstrikeConfig.radius*(.97+.03*Math.sin(t*4)));
      const fall=(now-flight.releasedAt)/(flight.impactAt-flight.releasedAt),p=Math.max(0,Math.min(1,fall));
      v.missile.visible=fall>=0&&fall<1;
      v.missile.position.set(flight.x,flight.y+(airstrikeConfig.altitude-strikePresentation.releaseClearance-flight.y)*(1-p*p),flight.z);
      this.position.set(0,-1,0);v.missile.quaternion.setFromUnitVectors(forward,this.position);
      if(!v.passSound&&Math.abs(t-release)<.6){v.passSound=true;this.sound('flyover',v.plane.position);}
      const age=(now-flight.impactAt)/1000,a=Math.max(0,age),life=a/airstrikeConfig.explosionDuration;
      const exploding=age>=0&&life<1;
      if(!v.impactSound&&age>=0){v.impactSound=true;if(age<.5)this.sound('impact',this.position.set(flight.x,flight.y,flight.z));}
      v.ring.visible=v.burst.visible=v.fragments.visible=exploding;
      if(!exploding)continue;
      v.ring.position.set(flight.x,flight.y+.09,flight.z);v.ring.scale.setScalar(airstrikeConfig.radius*(1-Math.exp(-a*3)));(v.ring.material as MeshBasicMaterial).opacity=.8*Math.pow(1-life,2);
      v.burst.position.set(flight.x,flight.y+.3,flight.z);v.burst.scale.set(1, .75, 1).multiplyScalar(.15+3.6*(1-Math.exp(-a*8)));v.burst.rotation.set(a*.9,a*.6,a*.3);(v.burst.material as MeshBasicMaterial).opacity=.72*Math.max(0,1-a/1.15);
      (v.fragments.material as MeshStandardMaterial).opacity=.9*Math.pow(1-life,1.5);
      let seed=17;for(let i=0;i<flight.id.length;i++)seed=(seed*31+flight.id.charCodeAt(i))>>>0;
      const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
      for(let i=0;i<v.fragments.count;i++) {
        const angle=random()*Math.PI*2,speed=1.2+random()*3.8,lift=.6+random()*2.7,scale=.5+random()*1.2;
        const drift=1-Math.exp(-a*1.35);
        this.dummy.position.set(flight.x+Math.cos(angle)*speed*drift,flight.y+.15+Math.max(0,lift*a-a*a*.8),flight.z+Math.sin(angle)*speed*drift);
        this.dummy.rotation.set(random()*3+a,angle+a*.45,random()*3-a*.7);this.dummy.scale.setScalar(scale*Math.max(.01,1-life));this.dummy.updateMatrix();v.fragments.setMatrixAt(i,this.dummy.matrix);
      }
      v.fragments.instanceMatrix.needsUpdate=true;
    }
  }
  dispose(): void {
    const geometries=new Set<BufferGeometry>(),materials=new Set<Material>();
    this.root.traverse(object=>{if(object instanceof Mesh||object instanceof LineSegments){geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);if(object instanceof InstancedMesh)object.dispose();}});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());this.root.removeFromParent();this.pool.length=0;this.flights=[];
  }
}

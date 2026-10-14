import { BufferGeometry, CircleGeometry, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, Shape, SphereGeometry, Vector3 } from 'three';

export function createAircraft(): Group {
  const aircraft = new Group(); aircraft.name = 'SDP / interceptor';
  const white = new MeshStandardMaterial({ color: 0xd9e0e3, metalness: .52, roughness: .38 });
  const graphite = new MeshStandardMaterial({ color: 0x242a2e, metalness: .65, roughness: .43 });
  const glass = new MeshStandardMaterial({ color: 0x17262e, metalness: .85, roughness: .16 });
  const silver = new MeshStandardMaterial({ color: 0x9aa9b0, metalness: .8, roughness: .32 });
  const outline = new LineBasicMaterial({ color: 0x64767d, transparent: true, opacity: .48 });
  const exhaust = new MeshBasicMaterial({ color: 0xc3dce6 });
  const exhaustGeometry = new CircleGeometry(.18, 16);
  const panel = (points: number[][], material: MeshStandardMaterial, y: number, depth = .065) => {
    const shape = new Shape(); points.forEach(([x, z], i) => i ? shape.lineTo(x, z) : shape.moveTo(x, z)); shape.closePath();
    const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 1, bevelSize: .035, bevelThickness: .025 });
    geometry.rotateX(-Math.PI / 2);
    const mesh = new Mesh(geometry, material); mesh.position.y = y; aircraft.add(mesh); return mesh;
  };
  const silhouette = [[0,7.7],[-.42,3.3],[-1.05,1.4],[-4.8,-4.5],[-3.5,-5.4],[-2.7,-4.7],[-1.9,-5.65],[-.8,-5.3],[0,-5.9],[.8,-5.3],[1.9,-5.65],[2.7,-4.7],[3.5,-5.4],[4.8,-4.5],[1.05,1.4],[.42,3.3]];
  panel(silhouette, graphite, -.08, .12);
  for (const sign of [-1, 1]) {
    panel([[-.7,1.7],[-4.35,-4.42],[-3.5,-4.94],[-2.75,-4.03],[-1.9,-4.95],[-1.12,-4.55]].map(([x,z])=>[x*sign,z]), white, .09);
    panel([[.35,3.6],[.8,2.0],[1.85,1.35],[1.55,.85],[.48,1.6]].map(([x,z])=>[x*sign,z]), silver, .14);
    const fin = panel([[0,0],[0,1.3],[1.0,.55],[.8,0]], graphite, 0);
    fin.rotation.x = Math.PI / 2; fin.rotation.z = sign * .52; fin.position.set(sign * 1.1, .4, 3.6);
  }
  const sections = [[-7.7,.015,.025],[-6.6,.20,.12],[-4.5,.37,.35],[-2.0,.54,.45],[.8,.72,.36],[3.3,.85,.30],[5.25,.63,.22],[5.8,.50,.12]];
  const positions: number[] = [], indices: number[] = [], sides = 20;
  sections.forEach(([z,width,height], ring) => {
    for(let side=0;side<sides;side++) {
      const a=side/sides*Math.PI*2;positions.push(Math.cos(a)*width,.17+Math.sin(a)*height,z);
      if(ring<sections.length-1){const i=ring*sides+side,n=ring*sides+(side+1)%sides;indices.push(i,n,i+sides,n,n+sides,i+sides);}
    }
  });
  const body = new BufferGeometry(); body.setAttribute('position',new Float32BufferAttribute(positions,3));body.setIndex(indices);body.computeVertexNormals();
  aircraft.add(new Mesh(body,white));
  const canopy = new Mesh(new SphereGeometry(1,20,12),glass);canopy.scale.set(.29,.26,1.5);canopy.position.set(0,.47,-3.9);aircraft.add(canopy);
  for (const x of [-.8,0,.8]) {
    const engine = new Mesh(new CylinderGeometry(.23,.29,1.15,12,1,true),graphite);engine.rotation.x=Math.PI/2;engine.position.set(x,.03,5.15);aircraft.add(engine);
    const rim = new Mesh(new CylinderGeometry(.28,.28,.13,16,1,true),silver);rim.rotation.x=Math.PI/2;rim.position.set(x,.03,5.77);aircraft.add(rim);
    const core = new Mesh(exhaustGeometry, exhaust);core.position.set(x,.03,5.8);aircraft.add(core);
  }
  const seams: Vector3[] = [];
  for(const sign of [-1,1]) for(const [a,b] of [[[.8,1.1],[3.75,-4.1]],[[1.25,-2],[2.75,-4.2]],[[.58,-.8],[.7,-4.5]]]) {
    seams.push(new Vector3(a[0]*sign,.19,-a[1]),new Vector3(b[0]*sign,.19,-b[1]));
  }
  aircraft.add(new LineSegments(new BufferGeometry().setFromPoints(seams),outline));
  return aircraft;
}

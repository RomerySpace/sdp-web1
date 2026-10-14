import { Vector3 } from 'three';
import { createElement, Crosshair, Plane, X } from 'lucide';
import { airstrikeConfig, type StrikeSlot } from '../../../../shared/AirstrikeProtocol';
import type { MapLoader } from '../world/MapLoader';
import type { NetworkPlayer } from '../../../../shared/MultiplayerProtocol';
import './airstrike.css';

export class TargetingMap {
  readonly element = document.createElement('section');
  readonly canvas = document.createElement('canvas');
  private readonly overlay = document.createElement('canvas');
  private readonly marker = document.createElement('div');
  private readonly confirm = document.createElement('button');
  private readonly coordinate = document.createElement('output');
  private readonly events = new AbortController();
  private map?: MapLoader;
  private span = 1;
  private centerX = 0; private centerZ = 0;
  private size = 1536;
  private phase: 'hidden' | 'opening' | 'open' | 'closing' = 'hidden';
  private progress = 0;
  private selected?: { x: number; z: number };
  private cursor = { u: .5, v: .5 };
  slot: StrikeSlot = 1;
  get blocking(): boolean { return this.phase !== 'hidden'; }
  get blend(): number { return this.progress; }
  constructor(container: HTMLElement, launch: (slot: StrikeSlot, x: number, z: number) => void, cancel: () => void) {
    this.element.className = 'airstrike-map'; this.element.hidden = true;
    this.element.setAttribute('role','dialog');this.element.setAttribute('aria-modal','true');this.element.setAttribute('aria-label','Airstrike targeting map');
    const header=document.createElement('header');header.innerHTML='<span class="strike-map-brand">SDP</span><div><strong>TACTICAL PROJECTION</strong><span>DE_DUST2 / AERIAL PROTOCOL</span></div>';
    const close=document.createElement('button');close.type='button';close.className='strike-map-close';close.setAttribute('aria-label','Close targeting map');close.title='Close targeting map';close.append(createElement(X));close.addEventListener('click',cancel,{signal:this.events.signal});header.append(close);
    const sheet=document.createElement('div');sheet.className='strike-map-sheet';
    this.canvas.width=this.canvas.height=this.overlay.width=this.overlay.height=this.size;this.canvas.className='strike-map-terrain';this.overlay.className='strike-map-overlay';
    this.canvas.tabIndex=0;this.canvas.setAttribute('aria-label','Select airstrike target on Dust 2');this.canvas.setAttribute('role','application');
    this.marker.className='strike-map-marker';this.marker.hidden=true;this.marker.append(createElement(Crosshair));
    sheet.append(this.canvas,this.overlay,this.marker);
    const footer=document.createElement('footer');this.coordinate.className='strike-map-coordinate';this.coordinate.textContent='TARGET / --';
    this.confirm.type='button';this.confirm.className='strike-map-confirm';this.confirm.disabled=true;this.confirm.append(createElement(Plane),document.createTextNode('DEPLOY AIRSTRIKE'));
    this.confirm.addEventListener('click',()=>{if(this.phase==='open'&&this.selected){const {x,z}=this.selected;launch(this.slot,x,z);}},{signal:this.events.signal});footer.append(this.coordinate,this.confirm);
    this.element.append(header,sheet,footer);container.append(this.element);
    this.canvas.addEventListener('pointerdown',event=>{
      if(this.phase!=='open')return;event.preventDefault();const r=this.canvas.getBoundingClientRect();
      this.select((event.clientX-r.x)/r.width,(event.clientY-r.y)/r.height);
    },{signal:this.events.signal});
    this.canvas.addEventListener('keydown',event=>{
      if(this.phase!=='open')return;
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter'].includes(event.code))return;event.preventDefault();
      if(event.code==='Enter'){if(this.selected)this.confirm.click();return;}
      this.select(this.cursor.u+(event.code==='ArrowRight'?2:event.code==='ArrowLeft'?-2:0)/this.span,
        this.cursor.v+(event.code==='ArrowDown'?2:event.code==='ArrowUp'?-2:0)/this.span);
    },{signal:this.events.signal});
  }
  async prepare(map: MapLoader): Promise<void> {
    this.map=map;this.centerX=(map.bounds.min.x+map.bounds.max.x)/2;this.centerZ=(map.bounds.min.z+map.bounds.max.z)/2;
    this.span=Math.max(map.bounds.max.x-map.bounds.min.x,map.bounds.max.z-map.bounds.min.z)*1.14;
    const ctx=this.canvas.getContext('2d')!;ctx.fillStyle='#eff4f6';ctx.fillRect(0,0,this.size,this.size);
    const triangles:number[][]=[];
    for(const geometry of map.geometries){const p=geometry.getAttribute('position'),index=geometry.index!;
      for(let i=0;i<index.count;i+=3){const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2);
        const ax=p.getX(a),ay=p.getY(a),az=p.getZ(a),bx=p.getX(b),by=p.getY(b),bz=p.getZ(b),cx=p.getX(c),cy=p.getY(c),cz=p.getZ(c);
        const ny=(bz-az)*(cx-ax)-(bx-ax)*(cz-az);if(ny<.035)continue;
        triangles.push([(ay+by+cy)/3,ax,az,bx,bz,cx,cz]);
      }
    }
    triangles.sort((a,b)=>a[0]-b[0]);
    for(let i=0;i<triangles.length;i++){
      const [height,ax,az,bx,bz,cx,cz]=triangles[i],shade=Math.round(218-Math.min(1,Math.max(0,height)/10)*96);
      ctx.fillStyle=`rgb(${shade-9},${shade},${shade+5})`;ctx.beginPath();ctx.moveTo(this.px(ax),this.pz(az));ctx.lineTo(this.px(bx),this.pz(bz));ctx.lineTo(this.px(cx),this.pz(cz));ctx.closePath();ctx.fill();
      if(height>.65){ctx.strokeStyle='rgba(57,77,88,.18)';ctx.lineWidth=.65;ctx.stroke();}
      if(i%6000===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
    }
    ctx.strokeStyle='rgba(103,129,145,.2)';ctx.lineWidth=1;
    for(let i=0;i<=6;i++){const n=this.size*(.06+i*.88/6);ctx.beginPath();ctx.moveTo(n,.06*this.size);ctx.lineTo(n,.94*this.size);ctx.moveTo(.06*this.size,n);ctx.lineTo(.94*this.size,n);ctx.stroke();}
    ctx.fillStyle='#617b8b';ctx.font='500 20px monospace';ctx.textAlign='center';
    for(let i=0;i<6;i++){ctx.fillText(String.fromCharCode(65+i),this.size*(.06+(i+.5)*.88/6),this.size*.035);ctx.fillText(String(i+1),this.size*.025,this.size*(.06+(i+.5)*.88/6));}
    ctx.textAlign='right';ctx.font='18px monospace';ctx.fillText('N',this.size*.94,this.size*.98);
  }
  private px(x:number):number{return(.5+(x-this.centerX)/this.span)*this.size;}
  private pz(z:number):number{return(.5+(z-this.centerZ)/this.span)*this.size;}
  select(u:number,v:number):void {
    u=Math.max(0,Math.min(1,u));v=Math.max(0,Math.min(1,v));this.cursor={u,v};
    if(!this.map)return;const x=this.centerX+(u-.5)*this.span,z=this.centerZ+(v-.5)*this.span;
    const hit=this.map.trace(new Vector3(x,airstrikeConfig.maxTargetHeight,z),new Vector3(0,-1,0),airstrikeConfig.maxTargetHeight+5);
    const valid=!!hit?.face&&hit.face.normal.y>.55;
    this.selected=valid?{x,z}:undefined;this.confirm.disabled=!valid;this.marker.hidden=!valid;
    if(!valid){this.coordinate.textContent='TARGET UNAVAILABLE';return;}
    this.marker.style.left=`${u*100}%`;this.marker.style.top=`${v*100}%`;this.marker.style.width=this.marker.style.height=`${airstrikeConfig.radius*2/this.span*100}%`;
    const col=Math.max(0,Math.min(5,Math.floor((u-.06)/(.88/6)))),row=Math.max(1,Math.min(6,Math.floor((v-.06)/(.88/6))+1));
    this.coordinate.textContent=`GRID ${String.fromCharCode(65+col)}${row} / ${x.toFixed(1)} / ${z.toFixed(1)}`;
  }
  open(slot:StrikeSlot):void {this.slot=slot;this.phase='opening';this.progress=0;this.selected=undefined;this.cursor={u:.5,v:.5};this.marker.hidden=true;this.confirm.disabled=true;this.coordinate.textContent='TARGET / --';this.element.hidden=false;this.element.dataset.phase='opening';}
  close(immediate=false):void {this.confirm.disabled=true;if(this.element.contains(document.activeElement)&&document.activeElement instanceof HTMLElement)document.activeElement.blur();if(immediate){this.phase='hidden';this.progress=0;this.element.hidden=true;return;}this.phase='closing';this.element.dataset.phase='closing';}
  update(dt:number,player?:NetworkPlayer):void {
    if(this.phase==='hidden')return;
    this.progress=Math.max(0,Math.min(1,this.progress+(this.phase==='closing'?-1:1)*dt/.42));
    this.element.style.setProperty('--map-reveal',String(this.progress));
    if(this.phase==='opening'&&this.progress===1){this.phase='open';this.element.dataset.phase='open';this.canvas.focus({preventScroll:true});}
    if(this.phase==='closing'&&this.progress===0){this.phase='hidden';this.element.hidden=true;return;}
    const ctx=this.overlay.getContext('2d')!;ctx.clearRect(0,0,this.size,this.size);
    if(player){ctx.save();ctx.translate(this.px(player.x),this.pz(player.z));ctx.rotate(-player.yaw);ctx.fillStyle='#ffffff';ctx.strokeStyle='#334e60';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(0,-15);ctx.lineTo(10,11);ctx.lineTo(0,6);ctx.lineTo(-10,11);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();}
  }
  get bounds(){return{centerX:this.centerX,centerZ:this.centerZ,span:this.span};}
  dispose():void{this.events.abort();this.element.remove();this.map=undefined;this.canvas.width=this.overlay.width=1;}
}

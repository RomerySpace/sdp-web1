import { ShaderMaterial, Vector3 } from 'three';
/** A bounded fog volume: the box is only a ray-entry surface, never a visible shell. */
export function nebulaMaterial(bottom: number, height: number, time: { value: number }, reveal: { value: number }, horizon: { value: Vector3 }): ShaderMaterial {
  return new ShaderMaterial({ transparent: true, depthWrite: false,
    uniforms: { gardenTime: time, gardenReveal: reveal, atmosphereHorizon: horizon, lower: { value: new Vector3(-1.2,bottom,-1.2) }, upper: { value:new Vector3(1.2,bottom+height,1.2) } },
    vertexShader: `varying vec3 worldPoint;
      void main(){worldPoint=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(worldPoint,1.);}`,
    fragmentShader: `precision highp float;
      varying vec3 worldPoint;uniform float gardenTime;uniform float gardenReveal;uniform vec3 atmosphereHorizon;uniform vec3 lower;uniform vec3 upper;
      float field(vec3 p){return .5 + .12*sin(p.x*1.3+sin(p.y*.65))*sin(p.z*1.1+p.y*.45)+.045*sin(p.x*2.6+p.z*1.7)*sin(p.y*1.8);}
      void main(){
        vec3 direction=normalize(worldPoint-cameraPosition);
        vec3 inverseRay=1./(direction+vec3(.000001));
        vec3 t0=(lower-cameraPosition)*inverseRay,t1=(upper-cameraPosition)*inverseRay;
        vec3 entry=min(t0,t1),exitPoint=max(t0,t1);
        float start=max(max(entry.x,entry.y),entry.z), finish=min(min(exitPoint.x,exitPoint.y),exitPoint.z);
        start=max(start,0.);if(finish<=start)discard;
        float stride=min(finish-start,10.)/18.;
        vec3 sum=vec3(0.);float alpha=0.;
        for(int i=0;i<18;i++){
          vec3 point=cameraPosition+direction*(start+(float(i)+.5)*stride);
          vec3 p=point+vec3(gardenTime*.018,-gardenTime*.028,gardenTime*.012);
          vec2 corner=abs(point.xz)-vec2(.91);
          float boundary=length(max(corner,0.))+min(max(corner.x,corner.y),0.)-.22;
          float envelope=1.-smoothstep(-.12,.035,boundary);
          float emergence=smoothstep(lower.y,lower.y+.65,point.y);
          float n=field(p);float density=(1.15+.35*n)*envelope*emergence;
          float fade=exp(-max(point.y-9.,0.)*.045);
          float a=(1.-exp(-density*stride))*fade;
          vec3 color=mix(vec3(.64,.70,.75),vec3(.91,.94,.96),n);
          color *= .96+.04*smoothstep(-1.2,1.2,-point.x);
          sum+=(1.-alpha)*a*color;alpha+=(1.-alpha)*a;
        }
        float haze=1.-exp(-pow(length(worldPoint-cameraPosition)*.025,2.));
        vec3 color=sum/max(alpha,.001);
        vec3 hazeColor=mix(vec3(.72,.74,.76),atmosphereHorizon,smoothstep(18.,90.,length(worldPoint-cameraPosition)));
        color=mix(color,hazeColor,haze);
        gl_FragColor=vec4(color,alpha*(1.-haze*.92)*gardenReveal);
      }`,
  });
}

import {sampleScreenEffects,drawScreenEffects} from '../reference-v3/screen-effects.mjs';
import {sourceToWorld} from './furniture-contract.mjs';
function area(points){let a=0;for(let i=0;i<points.length;i++){const p=points[i],q=points[(i+1)%points.length];a+=p[0]*q[1]-q[0]*p[1];}return Math.abs(a/2);}
/** Small 192px screen texture, never redraw a 4K bench to animate its displays. */
export class BenchScreenOverlay {
  constructor(scene,screen,transform,key){
    this.screen=screen;this.key=key;this.components=[];this.lastKey=null;
    if(screen.kind==='front'){
      const xs=screen.polygon.map(p=>p[0]),ys=screen.polygon.map(p=>p[1]);
      const x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;
      if(w<=0||h<=0||area(screen.polygon)<1)throw new Error(`${screen.seatId}: degenerate screen polygon`);
      this.thin=w/h<0.08;
      this.add(scene,transform,`${key}-display`,[x,y,w,h],{visible:true,polygon:screen.polygon.map(([px,py])=>[(px-x)*192/w,(py-y)*192/h])});
    }
    if(screen.led){const [x,y,w=2,h=2]=screen.led;this.add(scene,transform,`${key}-led`,[x,y,w,h],{visible:false,led:[0,0,192,192]});}
  }
  add(scene,transform,key,bounds,config){
    const canvas=document.createElement('canvas');canvas.width=canvas.height=192;
    const ctx=canvas.getContext('2d'),texture=scene.textures.addCanvas(key,canvas),[x,y]=sourceToWorld(transform,bounds.slice(0,2));
    const sprite=scene.add.image(x,y,key).setOrigin(0).setDisplaySize(bounds[2]*transform.scale,bounds[3]*transform.scale).setDepth(-8);
    this.components.push({canvas,ctx,texture,sprite,config,bounds});
  }
  sample(state,ms,reducedMotion){
    const effects=this.components.map(c=>sampleScreenEffects(c.config,state,ms,{reducedMotion})),key=effects.map(e=>e.key).join('|');
    if(key===this.lastKey)return false;
    for(const [i,c]of this.components.entries()){c.ctx.clearRect(0,0,192,192);if(this.thin&&c.config.visible){
      const effect=effects[i],colors={idle:'#243b40',writing:'#80abb0',researching:'#789fb8',executing:'#83aa91',syncing:'#a9a3be',error:'#bb9184'};
      c.ctx.save();c.ctx.beginPath();c.ctx.moveTo(...effect.polygon[0]);for(const p of effect.polygon.slice(1))c.ctx.lineTo(...p);c.ctx.closePath();c.ctx.clip();
      c.ctx.globalAlpha=state==='idle'?0.6:state==='error'?0.65+effect.pulse:reducedMotion?0.75:0.72+0.06*Math.sin(effect.phase*Math.PI/12);
      c.ctx.fillStyle=colors[state];c.ctx.fillRect(0,0,192,192);c.ctx.restore();
    }else drawScreenEffects(c.ctx,effects[i]);c.texture.refresh();}
    this.lastKey=key;this.lastEffects=effects;return true;
  }
  snapshot(){return {seatId:this.screen.seatId,kind:this.screen.kind,thinSideScreen:!!this.thin,polygon:this.screen.kind==='front'?this.screen.polygon:[],led:this.screen.led??null,key:this.lastKey,styles:this.lastEffects?.map(e=>e.style)??[]};}
}

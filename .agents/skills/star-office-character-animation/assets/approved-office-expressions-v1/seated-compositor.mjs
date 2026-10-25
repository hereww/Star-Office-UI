export const BUSINESS_STATES=Object.freeze({idle:'idle',writing:'working',researching:'working',executing:'working',syncing:'syncing',error:'error'});
export async function loadImage(url){const image=new Image();image.src=url;await image.decode();return image;}
const pair=(v,name)=>{if(!Array.isArray(v)||v.length!==2||v.some(n=>!Number.isFinite(n)))throw new Error(`${name} 无效`)};
export class SeatedOfficePlayer{
  constructor(canvas,config,{baseUrl=import.meta.url,imageLoader=loadImage}={}){
    if(config.frameCount!==12||config.grid?.[0]!==4||config.grid?.[1]!==3)throw new Error('局部动作必须为4x3的12帧');
    if(config.workstation.direction!==config.character.direction||config.character.direction!=='down')throw new Error('角色与当前工位必须朝下同轴');
    pair(config.character.poseAnchor,'poseAnchor');pair(config.workstation.seatAnchor,'seatAnchor');
    if(!(config.character.scale>0&&config.character.scale<=4))throw new Error('scale 无效');
    this.config=structuredClone(config);this.canvas=canvas;this.ctx=canvas.getContext('2d');
    [canvas.width,canvas.height]=config.workstation.size;this.baseUrl=baseUrl;this.loader=imageLoader;
    this.state='writing';this.frame=0;this.faceFrame=0;this.view='combined';this.visibleCharacter=true;this.faceEnabled=true;this.images={};
  }
  async initialize(){
    const config=this.config,character=config.character;
    for(const [key,url] of [['back',config.workstation.back],['front',config.workstation.front],['base',character.base],...Object.entries(character.actions).map(([name,a])=>[name,a.face])])this.images[key]=await this.loader(new URL(url,this.baseUrl).href);
    for(const key of ['back','front','base'])if(this.images[key].width!==192||this.images[key].height!==192)throw new Error('底图必须是完整192x192画布');
    for(const key of Object.keys(character.actions))this.assertAtlas(this.images[key],character.faceFrameSize);
    this.draw();return this;
  }
  assertAtlas(image,[w,h]){if(image.width!==w*4||image.height!==h*3)throw new Error('局部图集尺寸不符');}
  setState(state){if(!Object.hasOwn(BUSINESS_STATES,state))throw new Error('只接受原六业务状态');this.state=state;this.frame=0;this.faceFrame=0;this.draw();}
  setFrame(frame){if(!Number.isInteger(frame)||frame<0||frame>11)throw new Error('帧索引应为0..11');this.frame=frame;this.faceFrame=frame;this.draw();}
  sample(ms){
    const tick=Math.floor(Math.max(0,ms)*this.config.fps/1000);
    this.frame=tick%12;
    // Working/syncing blink sparsely; sleeping snores with a hold; dizzy eyes loop continuously.
    // The body and furniture are never transformed by any expression clock.
    const clock=this.config.character.actions[this.action()].faceClockFrames??this.config.faceClockFrames;
    const faceTick=tick%clock;
    this.faceFrame=faceTick<12?faceTick:0;
    this.draw();
  }
  action(){return BUSINESS_STATES[this.state]}
  atlas(ctx,image,[w,h],frame,destination){ctx.drawImage(image,frame%4*w,Math.floor(frame/4)*h,w,h,...destination)}
  bodyPlacement(){
    const c=this.config.character,[sx,sy]=this.config.workstation.seatAnchor;
    return [sx-c.poseAnchor[0]*c.scale,sy-c.poseAnchor[1]*c.scale,c.frameSize[0]*c.scale,c.frameSize[1]*c.scale];
  }
  drawActor(ctx){
    if(!this.visibleCharacter)return;
    const c=this.config.character,[x,y,w,h]=this.bodyPlacement();
    // Always the same base texture and coordinates. No frame-dependent body transform.
    ctx.drawImage(this.images.base,x,y,w,h);
    if(this.faceEnabled){
      const [cx,cy,rx,ry]=c.faceClipEllipse,[fx,fy,fw,fh]=c.faceRect;
      ctx.save();ctx.beginPath();ctx.ellipse(x+cx*c.scale,y+cy*c.scale,rx*c.scale,ry*c.scale,0,0,Math.PI*2);ctx.clip();
      this.atlas(ctx,this.images[this.action()],c.faceFrameSize,this.faceFrame,[x+fx*c.scale,y+fy*c.scale,fw*c.scale,fh*c.scale]);ctx.restore();
    }
  }
  draw(){
    const ctx=this.ctx;ctx.clearRect(0,0,this.canvas.width,this.canvas.height);ctx.imageSmoothingEnabled=false;if(!this.images.base)return;
    if(this.view!=='character')ctx.drawImage(this.images.back,0,0);
    if(this.view!=='workstation')this.drawActor(ctx);
    if(this.view!=='character')ctx.drawImage(this.images.front,0,0);
  }
  snapshot(){return {state:this.state,action:this.action(),frame:this.frame,faceFrame:this.faceFrame,frameCount:12,fps:this.config.fps,
    animationMode:'expression-only',faceClockFrames:this.config.character.actions[this.action()].faceClockFrames??this.config.faceClockFrames,handsRendered:false,bodyFixed:true,bodyPlacement:this.bodyPlacement(),seatAnchor:this.config.workstation.seatAnchor,
    faceEnabled:this.faceEnabled,visibleCharacter:this.visibleCharacter,view:this.view}}
}

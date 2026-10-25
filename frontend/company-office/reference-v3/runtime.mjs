import { DirectionalSeatedPlayer, BUSINESS_STATES, validateDirectionalAssets } from './directional-player.mjs';
import { OfficeRenderQuality, OFFICE_TEXT_FONT } from './render-quality.mjs';
import { ServerCabinetAnimation, SERVER_CABINET_STATES } from './server-cabinet-animation.mjs';

export const STATE_LABELS = Object.freeze({idle:'休息中',writing:'写作中',researching:'调研中',executing:'执行中',syncing:'同步中',error:'出错了'});
const COLORS = Object.freeze({idle:0x63818a,writing:0x49796d,researching:0x346887,executing:0x4e7350,syncing:0x8d6e3d,error:0xa65049});
const DIRECTIONS = ['up','down','left','right'];
const DIRECT_DRAG_THRESHOLD_PX = 8;
const exceededDirectDrag = (origin, point) => Boolean(origin && point && Math.hypot(point.x-origin.x, point.y-origin.y) > DIRECT_DRAG_THRESHOLD_PX);
const validState = state => Object.hasOwn(BUSINESS_STATES,state);
const finitePair = point => Array.isArray(point) && point.length===2 && point.every(Number.isFinite);
const finiteRect = rect => Array.isArray(rect) && rect.length===4 && rect.every(Number.isFinite) && rect[2]>0 && rect[3]>0;
const containsRect = (bounds,rect) => finiteRect(rect) && rect[0]>=bounds[0] && rect[1]>=bounds[1] && rect[0]+rect[2]<=bounds[0]+bounds[2] && rect[1]+rect[3]<=bounds[1]+bounds[3];
const containsPoint = (bounds,point) => finitePair(point) && point[0]>=bounds[0] && point[1]>=bounds[1] && point[0]<=bounds[0]+bounds[2] && point[1]<=bounds[1]+bounds[3];
export function occupiedBounds(station) {
  const [x,y]=station.center,s=station.scale;
  // A shared alpha-safe furniture envelope, not overlapping transparent 192px canvas margins.
  const [bx,by,bw,bh]=station.occupied ?? [28,30,146,144];
  return [x+(bx-96)*s,y+(by-96)*s,bw*s,bh*s];
}
export function overlaps(a,b){return a[0]<b[0]+b[2]&&a[0]+a[2]>b[0]&&a[1]<b[1]+b[3]&&a[1]+a[3]>b[1];}
export function validateReferenceLayout(layout) {
  if(!finitePair(layout.size)||!layout.size.every(n=>Number.isInteger(n)&&n>=192&&n<=8192)) throw new Error('地图尺寸无效');
  if(layout.directionRule!=='cardinal-only'||layout.walkIntegrated!==false) throw new Error('只支持四向固定坐姿，不允许行走');
  if(!Array.isArray(layout.stations)||layout.stations.length!==16) throw new Error('办公区必须恰好16席');
  const ids=new Set(),mapBounds=[0,0,...layout.size];
  for(const station of layout.stations){
    if(!station.id||ids.has(station.id)) throw new Error('工位ID重复或缺失');
    ids.add(station.id);
    if(!DIRECTIONS.includes(station.direction)||!finitePair(station.center)||!(station.scale>0&&station.scale<=1.25)||!['west','east'].includes(station.region)) throw new Error('工位方向/位置/分区无效');
    const b=occupiedBounds(station);
    if(!containsRect(mapBounds,b)) throw new Error('工位超出地图');
    if((layout.forbidden??[]).some(area=>overlaps(b,area.bounds))) throw new Error(`工位占用房间或门洞: ${station.id}`);
  }
  for(const region of ['west','east']) if(layout.stations.filter(s=>s.region===region).length!==8) throw new Error('红区和绿区必须各8席');
  for(let i=0;i<layout.stations.length;i++)for(let j=i+1;j<layout.stations.length;j++)if(overlaps(occupiedBounds(layout.stations[i]),occupiedBounds(layout.stations[j]))) throw new Error('工位家具重叠');
  if(!ids.has(layout.mainStation)) throw new Error('主工位不存在');
  if(!Array.isArray(layout.rooms)) throw new Error('房间坐标无效');
  for(const room of layout.rooms){
    if(!finiteRect(room?.bounds)||!finitePair(room?.label)) throw new Error('房间坐标无效');
    if(!containsRect(mapBounds,room.bounds)||!containsPoint(mapBounds,room.label)) throw new Error('房间超出地图');
  }
  if(!finiteRect(layout.server?.bounds)||!finitePair(layout.server?.indicator)) throw new Error('设备间点位无效');
  if(!containsRect(mapBounds,layout.server.bounds)) throw new Error('服务器超出地图');
  // The status label may sit below the equipment room, but must stay on the map.
  if(!containsPoint(mapBounds,layout.server.indicator)) throw new Error('设备间指示器超出地图');
  const equipment=layout.rooms.find(r=>r.id==='equipment');
  if(!equipment||!containsRect(equipment.bounds,layout.server.bounds)) throw new Error('服务器必须位于设备间');
  return layout;
}
async function json(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`办公室资源加载失败 (${r.status})`);return r.json();}
function actualSpec(spec,main){return {name:main?'橘猫 · 主同事':spec.name,state:'idle',detail:main?'正在连接实际状态':'尚未绑定人员或状态来源',source:main?'live':'unbound',bound:main,agentId:main?'main':null};}
function equalData(a,b){return a.name===b.name&&a.state===b.state&&a.detail===b.detail&&a.source===b.source&&a.bound===b.bound&&a.agentId===b.agentId;}

/** V3 Phaser scene adapter. Six business states, sixteen independent clocks, fixed seats. */
export class ReferenceOfficeRuntime {
  static async load(path){
    const baseUrl=new URL(path,location.href).href;
    const [layout,assets]=await Promise.all([json(new URL('layout.json',baseUrl)),json(new URL('assets.json',baseUrl))]);
    const runtime=new ReferenceOfficeRuntime(layout,assets,baseUrl);
    await Promise.all(runtime.stations.map(async station=>{
      station.player=await new DirectionalSeatedPlayer(document.createElement('canvas'),assets,{baseUrl,direction:station.direction,reducedMotion:runtime.reducedMotion}).initialize();
      station.player.setState('idle');
    }));
    runtime.player=runtime.getStation(layout.mainStation).player;
    return runtime;
  }
  constructor(layout,assets,baseUrl){
    this.layout=structuredClone(validateReferenceLayout(layout));
    this.assets=structuredClone(validateDirectionalAssets(assets));this.baseUrl=baseUrl;
    this.ready=false;this.view='overview';this.state='idle';this.activeStation=layout.mainStation;this.demoMode=false;this.directPointer=null;
    this.reducedMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false;
    this.stations=layout.stations.map(spec=>({...structuredClone(spec),...actualSpec(spec,spec.id===layout.mainStation),actual:actualSpec(spec,spec.id===layout.mainStation),epoch:0,lastTick:-1,version:0}));
    this.serverVersion=0;this.stateEpoch=0;this.characterVersion=0;this.remoteAgents=[];this.unplacedAgents=[];this.lastSceneTick=-1;this.hoveredStation=null;this.hoverPulseTime=0;this.managedPointerInteractions=false;
    // The static rack remains the source asset. The animation layer is driven
    // by the telemetry adapter when available, and falls back to the legacy
    // main-seat indicator for standalone/reference consumers.
    this.serverCabinetAnimation=new ServerCabinetAnimation(this.layout,{reducedMotion:this.reducedMotion});
    this.serverAnimationState=null;
    this.serverAnimationDetail='';
    this.serverAnimationSource='local';
  }
  getStation(id){const station=this.stations.find(s=>s.id===id);if(!station)throw new Error('工位不存在');return station;}
  preload(scene){scene.load.image('office_bg',new URL(this.layout.background,this.baseUrl).href);scene.load.image('office-v3-server',new URL(this.layout.server.asset,this.baseUrl).href);}
  create(scene){
    this.scene=scene;
    const [w,h]=this.layout.size;const background=scene.add.image(w/2,h/2,'office_bg').setDepth(-100);
    // The artwork may have a higher-resolution backing; stations always use logical map pixels.
    const sourceW=background.width,sourceH=background.height;
    if(!(sourceW>0&&sourceH>0)||Math.abs(sourceW*h-sourceH*w)>Math.max(w,h))throw new Error('地图源图与逻辑坐标长宽比不匹配');
    background.setDisplaySize(w,h);
    this.backgroundSourceSize=[sourceW,sourceH];
    this.renderQuality=new OfficeRenderQuality(scene,scene.sys.game.canvas.parentElement,()=>{if(this.ready)this.applyView();});
    globalThis.window.officeRenderQuality={snapshot:()=>this.renderQuality.snapshot()};
    for(const station of this.stations){
      const [cx,cy]=station.center,scale=station.scale;
      station.textureKey=`office-v3-seat-${station.id}-0`;
      station.texture=scene.textures.addCanvas(station.textureKey,station.player.canvas);
      station.sprite=scene.add.image(cx-96*scale,cy-96*scale,station.textureKey).setOrigin(0).setScale(scale).setDepth(cy+80);
      station.sprite.setData('companyOfficeLocked',true).setData('companyOfficeStationId',station.id);
      // The old full 192px canvas hit box overlaps the adjacent row when the
      // camera is zoomed. Use the validated occupied envelope instead, so the
      // visual hover target and the click target are the same workstation.
      const [hitX,hitY,hitW,hitH]=station.occupied??[28,30,146,144];
      const Phaser=globalThis.Phaser;
      if(Phaser?.Geom?.Rectangle)station.sprite.setInteractive({hitArea:new Phaser.Geom.Rectangle(hitX,hitY,hitW,hitH),hitAreaCallback:Phaser.Geom.Rectangle.Contains,useHandCursor:true});
      else station.sprite.setInteractive({useHandCursor:true});
      station.sprite.on('pointerover',()=>this.setHoverStation(station.id));
      station.sprite.on('pointerout',()=>this.clearHoverStation(station.id));
      // The map loader owns click-vs-drag arbitration in the live office. Keep
      // the direct handler for standalone V3/V4 consumers and unit fixtures.
      if(!this.managedPointerInteractions)station.sprite.on('pointerdown',pointer=>this.beginDirectPointer(station.id,pointer));
      station.bubbleBackground=scene.add.graphics().setDepth(4200);
      station.bubbleText=scene.add.text(0,0,'',{fontFamily:OFFICE_TEXT_FONT,fontSize:'11px',color:'#fef9e9',align:'center',padding:{x:4,y:1}}).setOrigin(0.5).setDepth(4201);
      // Bubbles are annotations, not hit targets. Keeping them non-interactive
      // prevents a relocated label from stealing a hover/click from the seat
      // underneath it; the workstation envelope remains the single target.
      station.bubbleText.setData('companyOfficeLocked',true).setData('companyOfficeStationId',station.id);
      this.refreshAnchor(station);this.refreshBubble(station);
    }
    if(!this.managedPointerInteractions&&scene.input){
      scene.input.on('pointermove',pointer=>this.moveDirectPointer(pointer));
      scene.input.on('pointerup',pointer=>this.endDirectPointer(pointer));
      scene.input.on('gameout',()=>{this.directPointer=null;this.setHoverStation(null);});
    }
    this.hoverSelection=scene.add.graphics().setDepth(4300);
    this.selection=scene.add.graphics().setDepth(4050);
    this.roomLabels=[];
    for(const room of [...this.layout.rooms,...this.layout.zones]){
      if(room.id==='equipment')continue;
      const label=scene.add.text(...room.label,room.name,{fontFamily:OFFICE_TEXT_FONT,fontSize:room.id==='west'||room.id==='east'?'13px':'15px',color:'#faf3df',backgroundColor:'#3c4a48',padding:{x:7,y:3}}).setOrigin(0.5).setDepth(4000);
      label.setData('companyOfficeLocked',true);label._officeRoom=room;label._officeZone=['west','east'].includes(room.id);this.roomLabels.push(label);
    }
    this.entryLabel=scene.add.text(665,951,'主入口',{fontFamily:OFFICE_TEXT_FONT,fontSize:'16px',color:'#fff6de'}).setOrigin(0.5).setDepth(4000);
    const [sx,sy,sw,sh]=this.layout.server.bounds;
    this.serverSprite=scene.add.image(sx+sw/2,sy+sh/2,'office-v3-server').setDisplaySize(sw,sh).setDepth(sy+sh);this.serverSprite.setData('companyOfficeLocked',true);
    this.serverWarning=scene.add.graphics().setDepth(3900);
    this.serverLights=(this.layout.server.leds??[]).map(([lx,ly])=>scene.add.rectangle(sx+lx,sy+ly,3,2,0x6cb597).setDepth(3901));
    this.serverLabel=scene.add.text(...this.layout.server.indicator,'设备间 · 待命',{fontFamily:OFFICE_TEXT_FONT,fontSize:'12px',color:'#e5e6dc',backgroundColor:'#374847',padding:{x:6,y:3}}).setOrigin(0.5).setDepth(4000);
    this.serverCabinetAnimation?.create(scene,{sprite:this.serverSprite,lights:this.serverLights,warning:this.serverWarning,label:this.serverLabel});
    this.ready=true;this.refreshMain();this.applyView();this.update(scene.time.now);
    // Camera scroll is not a ScaleManager resize. Observe it separately after
    // input/update, including external zoom changes, without fitting/resetting it.
    this.cameraAnnotationHandler=()=>this.refreshCameraAnnotations(scene.time.now);
    scene.events.on('postupdate',this.cameraAnnotationHandler);
    this.motionQuery=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.motionHandler=e=>{this.reducedMotion=e.matches;for(const s of this.stations){s.player.reducedMotion=e.matches;s.texture?.refresh();}this.serverCabinetAnimation?.setReducedMotion(e.matches);this.drawSelection();};
    this.motionQuery?.addEventListener('change',this.motionHandler);
    scene.events.once('shutdown',()=>{
      this.motionQuery?.removeEventListener('change',this.motionHandler);
      this.serverCabinetAnimation?.destroy();
      this.renderQuality?.destroy();
      scene.events.off('postupdate',this.cameraAnnotationHandler);
      if(globalThis.window?.officeRuntime===this)delete globalThis.window.officeRenderQuality;
    });
    globalThis.window?.dispatchEvent(new CustomEvent('office-runtime-ready',{detail:this}));
    return background;
  }
  emit(){globalThis.window?.dispatchEvent(new CustomEvent('office-runtime-change',{detail:this}));}
  refreshAnchor(station){
    const [x,y,w,h]=station.player.bodyPlacement(),c=station.player.spec.character;
    // Full-frame character atlases carry the complete head pixels. Keep only
    // the declared anchor; legacy face-ellipse metadata is rollback evidence
    // and must never participate in the active runtime graph.
    const [hx,hy]=c.headAnchor??[96,35];
    station.headAnchor=[station.center[0]-96*station.scale+(x+hx*c.scale)*station.scale,station.center[1]-96*station.scale+(y+hy*c.scale)*station.scale];
  }
  refreshBubble(station){
    if(!station.bubbleText)return;
    if(this.renderQuality){this.layoutClearBubbles();return;}
    const compact=this.view==='overview';
    const name=station.name.length>9?station.name.slice(0,8)+'…':station.name;
    const status=station.source==='unbound'?'未绑定':STATE_LABELS[station.state];
    const prefix=station.source==='demo'?'演示·':'';
    station.bubbleText.setText(compact?`${prefix}${status}`:`${name}\n${prefix}${status}`);
    station.bubbleText.setFontSize(compact?'11px':'11px');
    const width=Math.max(35,station.bubbleText.width+8),height=station.bubbleText.height+5;
    // Keep a 3px head gap after the 4px tail, including fractional/two-line text metrics.
    station.bubbleAnchor=[station.headAnchor[0],station.headAnchor[1]-height/2-7];
    const [x,y]=station.bubbleAnchor;
    station.bubbleText.setPosition(x,y);
    station.bubbleRect=[x-width/2,y-height/2,width,height];
    const graphics=station.bubbleBackground;graphics.clear();
    graphics.fillStyle(station.source==='unbound'?0x53615d:COLORS[station.state],0.96);
    graphics.fillRoundedRect(x-width/2,y-height/2,width,height,4);
    graphics.fillTriangle(x-3,y+height/2-1,x+3,y+height/2-1,x,y+height/2+4);
    graphics.lineStyle(station.id===this.activeStation?2:1,station.id===this.activeStation?0xe4c582:0xf1e6cf,0.9);
    graphics.strokeRoundedRect(x-width/2,y-height/2,width,height,4);
  }
  /** Labels are rasterized at physical density and kept at readable CSS size.
   * Dense overview seats get short leader callouts rather than covering heads.
   * Reflow changes only annotation geometry, never the actor or its clock. */
  layoutClearBubbles(){
    if(!this.renderQuality||this._layingOutBubbles)return;
    this._layingOutBubbles=true;
    try{
      const camera=this.scene.cameras.main,zoom=camera.zoom,density=this.renderQuality.density;
      const unit=density/zoom,compact=this.view==='overview'||(this.renderQuality.measurement.mobile&&this.view!=='workstation'),placed=[];
      const viewport=[camera.scrollX+camera.width/2-camera.width/(2*zoom),camera.scrollY+camera.height/2-camera.height/(2*zoom),camera.width/zoom,camera.height/zoom];
      const heads=this.stations.filter(s=>s.headAnchor).map(s=>[s.headAnchor[0]-30*s.scale,s.headAnchor[1]-2*s.scale,60*s.scale,56*s.scale]);
      const visible=rect=>overlaps(rect,viewport);
      const ordered=[...this.stations].sort((a,b)=>a.headAnchor?.[1]-b.headAnchor?.[1]||a.center[0]-b.center[0]);
      for(const s of ordered){
        if(!s.bubbleText||!s.headAnchor)continue;
        const name=s.name.length>9?s.name.slice(0,8)+'…':s.name;
        const status=s.source==='unbound'?'未绑定':STATE_LABELS[s.state],prefix=s.source==='demo'?(compact&&this.renderQuality.measurement.mobile?'':'演示·'):'';
        const content=compact?`${prefix}${status}`:`${name}\n${prefix}${status}`;
        if(s.bubbleText.text!==content)s.bubbleText.setText(content);
        this.renderQuality.styleText(s.bubbleText,compact?13:14);
        const width=s.bubbleText.displayWidth+8*unit,height=s.bubbleText.displayHeight+5*unit;
        const [hx,hy]=s.headAnchor;
        const preferred=[hx-width/2,hy-height-7*unit,width,height];
        const side=s.direction==='right'?-1:s.direction==='left'?1:(s.center[0]<this.layout.size[0]/2?-1:1);
        let best=preferred,found=false;
        // First retain the exact overhead position; then use a bounded annotation
        // rail outside the red two-column seating, with two staggered green rows.
        const offsets=[[0,0]];
        for(let row=0;row<8;row++)for(const shift of [0,side*(width+4*unit),-side*(width+4*unit),side*2*(width+4*unit)])offsets.push([shift,-row*(height+5*unit)]);
        const headVisible=visible([hx-1,hy-1,2,2]);
        s.bubbleVisible=headVisible;s.bubbleText.setVisible(headVisible);s.bubbleBackground.setVisible(headVisible);
        // A complete horizontal search is needed in phone overview: several
        // labels have less than a line-height of vertical room above their heads.
        const rail=[];
        for(let x=viewport[0]+3*unit;x+width<=viewport[0]+viewport[2]-3*unit;x+=width+4*unit)rail.push(x-preferred[0]);
        rail.sort((a,b)=>Math.abs(a)-Math.abs(b));
        for(let row=0;row<10;row++)for(const shift of rail)offsets.push([shift,-row*(height+5*unit)]);
        if(headVisible){
          for(const [dx,dy]of offsets){
            const rect=[preferred[0]+dx,preferred[1]+dy,width,height];
            if(rect[0]<viewport[0]+3*unit||rect[0]+width>viewport[0]+viewport[2]-3*unit||rect[1]<viewport[1]+3*unit)continue;
            const padded=[rect[0]-2*unit,rect[1]-2*unit,width+4*unit,height+4*unit];
            if(placed.some(other=>overlaps(padded,other))||heads.some(head=>overlaps(padded,head)))continue;
            best=rect;found=true;break;
          }
          if(!found){
            // Last-mile packing for the 16-seat phone overview: variable text
            // widths do not share a grid, so search the remaining gaps finely.
            const xs=[];
            for(let x=viewport[0]+3*unit;x+width<=viewport[0]+viewport[2]-3*unit;x+=4*unit)xs.push(x);
            xs.sort((a,b)=>Math.abs(a-preferred[0])-Math.abs(b-preferred[0]));
            // A head newly entering at the top border has no overhead room.
            // Keep its label visible in a side callout, rather than overlapping
            // the head or marking an otherwise visible station as uncullable.
            const top=Math.max(preferred[1],viewport[1]+3*unit);
            outer:for(let y=top;y>=viewport[1]+3*unit;y-=3*unit)for(const x of xs){
              const rect=[x,y,width,height],padded=[x-2*unit,y-2*unit,width+4*unit,height+4*unit];
              if(placed.some(other=>overlaps(padded,other))||heads.some(head=>overlaps(padded,head)))continue;
              best=rect;found=true;break outer;
            }
          }
          placed.push(best);
        }
        const [x,y]=best,centerX=x+width/2,centerY=y+height/2;
        s.bubbleRect=best;s.bubbleAnchor=[centerX,centerY];s.bubbleRelocated=Math.abs(centerX-hx)>unit||Math.abs(y-preferred[1])>unit;
        s.bubbleText.setPosition(centerX,centerY);
        s.bubbleText.setData('officeLabelCssFontSize',s.bubbleText._officeCssFontSize);
        const graphics=s.bubbleBackground;graphics.clear();
        const color=s.source==='unbound'?0x53615d:COLORS[s.state];
        graphics.fillStyle(color,0.97);graphics.fillRoundedRect(x,y,width,height,4*unit);
        if(s.bubbleRelocated){
          const tailX=Math.min(x+width-4*unit,Math.max(x+4*unit,hx));
          graphics.lineStyle(unit,0xf1e6cf,0.8);
          // A bent fine leader ends above the unchanged head, never over its face.
          graphics.beginPath();graphics.moveTo(tailX,y+height);graphics.lineTo(tailX,hy-4*unit);graphics.lineTo(hx,hy-4*unit);graphics.strokePath();
        }else graphics.fillTriangle(hx-3*unit,y+height-unit,hx+3*unit,y+height-unit,hx,y+height+4*unit);
        graphics.lineStyle((s.id===this.activeStation?2:1)*unit,s.id===this.activeStation?0xe4c582:0xf1e6cf,0.9);
        graphics.strokeRoundedRect(x,y,width,height,4*unit);
        s.bubblePlacementClear=found||!visible([hx-1,hy-1,2,2]);
      }
      this.layoutClearRoomLabels(unit,placed,heads);
      this._annotationCamera=this.annotationCameraSignature();
      this._annotationLayoutAt=this.scene.time.now;
      this.annotationReflows=(this.annotationReflows??0)+1;
    }finally{this._layingOutBubbles=false;}
  }
  annotationCameraSignature(){
    const camera=this.scene?.cameras.main;
    return camera?[camera.scrollX,camera.scrollY,camera.zoom,camera.width,camera.height,this.renderQuality.density]:[];
  }
  roomLabelFontSize(){return 14;}
  refreshCameraAnnotations(time){
    if(!this.ready||!this.renderQuality)return;
    const signature=this.annotationCameraSignature();
    if(this._annotationCamera?.every((value,index)=>value===signature[index]))return;
    // Max 30 reflows/sec during continuous drags. The postupdate observer keeps
    // the trailing camera change pending implicitly until this interval elapses.
    if(time-(this._annotationLayoutAt??-Infinity)<1000/30)return;
    const zoomChanged=!this._annotationCamera||signature[2]!==this._annotationCamera[2]||signature[5]!==this._annotationCamera[5];
    if(zoomChanged){
      const size=this.roomLabelFontSize();
      for(const label of this.roomLabels??[])this.renderQuality.styleText(label,size);
      if(this.entryLabel)this.renderQuality.styleText(this.entryLabel,size);
      if(this.serverLabel)this.renderQuality.styleText(this.serverLabel,Math.min(13,size));
    }
    this.layoutClearBubbles();
  }
  layoutClearRoomLabels(unit,bubbles,heads){
    for(const label of this.roomLabels??[]){
      const room=label._officeRoom;
      if(!room||label._officeZone)continue;
      const [lx,ly]=room.label,width=label.displayWidth,height=label.displayHeight;
      let rect=[lx-width/2,ly-height/2,width,height];
      const clear=r=>!bubbles.some(b=>overlaps(r,b))&&!heads.some(h=>overlaps(r,h));
      if(!clear(rect)){
        for(let step=1;step<8;step++){
          const candidate=[rect[0],rect[1]-step*(height+3*unit),width,height];
          if(candidate[1]<room.bounds[1])break;
          if(clear(candidate)){rect=candidate;break;}
        }
      }
      label.setPosition(rect[0]+width/2,rect[1]+height/2);
    }
  }
  refreshMain(){const s=this.getStation(this.layout.mainStation);this.player=s.player;this.state=s.state;this.stateEpoch=s.epoch;this.faceAnchor={x:s.headAnchor?.[0]??s.center[0],y:s.headAnchor?.[1]??s.center[1]};}
  beginDirectPointer(stationId,pointer){
    if(this.managedPointerInteractions)return;
    const camera=this.scene?.cameras?.main;
    this.directPointer={pointerId:pointer?.id,stationId,x:pointer?.x??0,y:pointer?.y??0,sx:camera?.scrollX??0,sy:camera?.scrollY??0,moved:false};
  }
  moveDirectPointer(pointer){
    const drag=this.directPointer;
    if(!drag||drag.pointerId!==pointer?.id)return;
    if(!drag.moved&&exceededDirectDrag(drag,pointer)){
      drag.moved=true;
      this.clearHoverStation(drag.stationId);
    }
    if(!drag.moved)return;
    const camera=this.scene?.cameras?.main;
    if(camera)camera.setScroll(drag.sx-(pointer.x-drag.x)/camera.zoom,drag.sy-(pointer.y-drag.y)/camera.zoom);
  }
  endDirectPointer(pointer){
    const drag=this.directPointer;
    if(!drag||drag.pointerId!==pointer?.id)return;
    this.directPointer=null;
    if(!drag.moved&&drag.stationId)this.selectStation(drag.stationId,{focus:false});
  }
  setHoverStation(id){
    if(id!==null&&this.pointerDragging)return;
    if(id!==null)this.getStation(id);
    if(this.hoveredStation===id)return;
    this.hoveredStation=id;this.drawSelection();
  }
  clearHoverStation(id){if(this.hoveredStation===id)this.setHoverStation(null);}
  drawSelection(){
    if(this.hoverSelection){
      this.hoverSelection.clear();
      if(this.hoveredStation){
        const hovered=this.getStation(this.hoveredStation),[x,y,w,h]=occupiedBounds(hovered);
        // Keep the feedback aligned to the station at every zoom level: the
        // padding and stroke are screen-sized rather than ballooning in world
        // pixels when a user zooms in to inspect a desk.
        const zoom=Math.max(0.3,this.scene?.cameras?.main?.zoom??1),unit=(this.renderQuality?.density??1)/zoom,pad=6*unit,radius=5*unit,stroke=2*unit;
        const pulse=this.reducedMotion?0.82:0.62+0.16*(1+Math.sin(this.hoverPulseTime/220))/2;
        this.hoverSelection.fillStyle(0xbc9759,0.12);
        this.hoverSelection.fillRoundedRect(x-pad,y-pad,w+2*pad,h+2*pad,radius);
        this.hoverSelection.lineStyle(stroke,0xbc9759,pulse);
        this.hoverSelection.strokeRoundedRect(x-pad,y-pad,w+2*pad,h+2*pad,radius);
        // Four short corner ticks remain legible at high zoom without covering
        // the character, screen effects, or the status bubble.
        this.hoverSelection.lineStyle(stroke,0xf8dda1,Math.min(1,pulse+0.15));
        const tick=8*unit;
        for(const [sx,sy,ex,ey] of [[x-pad,y-pad,x-pad+tick,y-pad],[x-pad,y-pad,x-pad,y-pad+tick],[x+w+pad,y-pad,x+w+pad-tick,y-pad],[x+w+pad,y-pad,x+w+pad,y-pad+tick],[x-pad,y+h+pad,x-pad+tick,y+h+pad],[x-pad,y+h+pad,x-pad,y+h+pad-tick],[x+w+pad,y+h+pad,x+w+pad-tick,y+h+pad],[x+w+pad,y+h+pad,x+w+pad,y+h+pad-tick]]){
          this.hoverSelection.beginPath();this.hoverSelection.moveTo(sx,sy);this.hoverSelection.lineTo(ex,ey);this.hoverSelection.strokePath();
        }
      }
    }
    if(!this.selection)return;this.selection.clear();
    const s=this.getStation(this.activeStation),[x,y,w,h]=occupiedBounds(s);
    this.selection.lineStyle(1.5,0xe6bc6e,0.92);this.selection.strokeRoundedRect(x-4,y-4,w+8,h+8,5);
  }
  selectStation(id,{focus=false}={}){this.getStation(id);this.activeStation=id;if(focus)this.view='workstation';this.applyView();this.emit();}
  setView(view){if(!['overview','west','east','workstation'].includes(view))throw new Error('未知地图视图');this.view=view;this.applyView();this.emit();}
  applyView(){
    if(!this.scene)return;const camera=this.scene.cameras.main,[w,h]=this.layout.size,s=this.getStation(this.activeStation);
    const spec=this.layout.views[this.view];const center=this.view==='workstation'?s.center:spec.center;
    const span=spec.span;
    // Short landscape canvases need room above the first seated row for its
    // screen-space label; fitting only the furniture span would clip that label.
    const annotationInset=this.renderQuality&&this.renderQuality.measurement.cssSize[1]<420&&this.view!=='overview'?56*this.renderQuality.density:0;
    const zoom=Math.min(camera.width/span[0],Math.max(1,camera.height-annotationInset)/span[1]);
    const padx=Math.max(0,(camera.width/zoom-w)/2),pady=Math.max(0,(camera.height/zoom-h)/2);
    camera.setBackgroundColor('#20252c');camera.setBounds(-padx,-pady,w+2*padx,h+2*pady);camera.setZoom(zoom);camera.centerOn(center[0],center[1]-annotationInset/(2*zoom));
    if(this.renderQuality){
      const size=this.roomLabelFontSize();
      for(const label of this.roomLabels??[])this.renderQuality.styleText(label,size);
      if(this.entryLabel)this.renderQuality.styleText(this.entryLabel,size);
      if(this.serverLabel)this.renderQuality.styleText(this.serverLabel,Math.min(13,size));
      this.layoutClearBubbles();
    }else for(const station of this.stations)this.refreshBubble(station);
    for(const label of this.roomLabels??[])if(label._officeZone)label.setVisible(this.view==='overview');
    this.drawSelection();
    for(const option of ['overview','workstation'])globalThis.document?.getElementById('office-view-'+option)?.setAttribute('aria-pressed',String(option===this.view));
  }
  _apply(station,data){
    const change=!equalData(station,data);const changedState=station.state!==data.state;
    Object.assign(station,data);
    if(changedState){station.epoch=this.scene?.time.now??0;station.player.setState(data.state);station.texture?.refresh();}
    this.refreshBubble(station);this.refreshMain();return change;
  }
  setState(state,force=false){
    if(!validState(state))state='idle';
    const s=this.getStation(this.layout.mainStation);s.actual={...s.actual,state,source:'live',bound:true};
    if(!this.demoMode&&this._apply(s,s.actual))this.emit();
  }
  setMainStatus(data={}){
    const s=this.getStation(this.layout.mainStation),state=validState(data.state)?data.state:'idle';
    s.actual={...s.actual,state,detail:typeof data.detail==='string'?data.detail:'',source:'live',bound:true};
    if(!this.demoMode&&this._apply(s,s.actual))this.emit();
  }
  /**
   * Set the equipment-room state supplied by a live service adapter. The
   * workstation state remains independent; this method is intentionally a
   * narrow visual bridge for Sub2API/plugin source health.
   */
  setServerCabinetState(state,{detail='',source='local'}={}){
    const next=SERVER_CABINET_STATES.includes(state)?state:'unknown';
    const changed=this.serverAnimationState!==next||this.serverAnimationDetail!==String(detail??'')||this.serverAnimationSource!==String(source??'local');
    this.serverAnimationState=next;this.serverAnimationDetail=String(detail??'');this.serverAnimationSource=String(source??'local');
    this.serverCabinetAnimation?.setState(next,{detail:this.serverAnimationDetail,source:this.serverAnimationSource});
    if(changed)this.emit();
    return changed;
  }
  setStationState(id,state,{detail='',source='demo'}={}){
    if(!validState(state))throw new Error('只支持原六业务状态');
    if(source!=='demo'||!this.demoMode)throw new Error('修改本地状态需要显式进入演示模式');
    const s=this.getStation(id);if(this._apply(s,{...s,state,detail:String(detail),source:'demo',bound:false,agentId:null}))this.emit();
  }
  async setStationDirection(id,direction){
    if(!DIRECTIONS.includes(direction))throw new Error('只支持上下左右四方向');
    const s=this.getStation(id);await s.player.setDirection(direction);
    s.direction=s.player.direction;s.texture?.refresh();this.refreshAnchor(s);this.refreshBubble(s);this.refreshMain();this.drawSelection();this.emit();
  }
  setDemoMode(enabled){
    if(typeof enabled!=='boolean')throw new Error('演示开关无效');if(enabled===this.demoMode)return;
    this.demoMode=enabled;
    const states=Object.keys(BUSINESS_STATES);
    for(const [index,s]of this.stations.entries()){
      const data=enabled?{name:s.name,state:states[index%states.length],detail:'本地演示，不提交后端',source:'demo',bound:false,agentId:null}:s.actual;
      this._apply(s,data);
    }
    this.emit();
  }
  syncAgents(agents){
    const mainAgent=this.getStation(this.layout.mainStation).actual.agentId,incoming=new Map();
    // First approved record wins: a duplicated agent must never occupy two seats.
    for(const agent of Array.isArray(agents)?agents:[]){
      if(!agent||typeof agent.agentId!=='string'||!agent.agentId||agent.agentId===mainAgent||agent.isMain||agent.isDemo||agent.authStatus!=='approved'||incoming.has(agent.agentId))continue;
      incoming.set(agent.agentId,agent);
    }
    this.remoteAgents=[...incoming.values()];
    const seats=this.stations.filter(s=>s.id!==this.layout.mainStation);
    const bySeat=new Map(seats.map(s=>[s.id,s])),ai=seats.filter(s=>s.role==='ai');
    const assignments=new Map(),assigned=new Set(),conflicts=new Set();
    const assign=(station,agent)=>{assignments.set(station.id,agent);assigned.add(agent.agentId);};
    // Reserve every online binding before considering newcomers or station hints.
    // Use actual, not the demo display, and include explicitly bound colleague seats.
    for(const station of seats){
      const agent=incoming.get(station.actual.agentId);
      if(station.actual.bound&&agent&&!assigned.has(agent.agentId))assign(station,agent);
    }
    // Explicit claims precede automatic allocation. Conflicts remain unplaced,
    // rather than evicting an online occupant or silently changing the requested seat.
    for(const agent of this.remoteAgents){
      if(assigned.has(agent.agentId))continue;
      const station=bySeat.get(agent.stationId);
      if(!station)continue;
      if(assignments.has(station.id))conflicts.add(agent.agentId);
      else assign(station,agent);
    }
    for(const agent of this.remoteAgents){
      if(assigned.has(agent.agentId)||conflicts.has(agent.agentId))continue;
      const station=ai.find(s=>!assignments.has(s.id));
      if(station)assign(station,agent);
    }
    this.unplacedAgents=this.remoteAgents.filter(a=>!assigned.has(a.agentId)).map(a=>({id:a.agentId,name:String(a.name??'AI同事')}));
    // Commit only after the complete plan is built; released seats may be reused,
    // but the main station and every surviving binding are left in place.
    for(const station of seats){
      const agent=assignments.get(station.id);
      if(agent)station.actual={name:String(agent.name??station.name),state:validState(agent.state)?agent.state:'idle',detail:String(agent.detail??''),source:'live',bound:true,agentId:agent.agentId};
      else if(station.actual.agentId)station.actual=actualSpec(this.layout.stations.find(s=>s.id===station.id),false);
      if(!this.demoMode)this._apply(station,station.actual);
    }
    this.emit();
  }
  guestPoint(area,index){const points=this.layout.guestSlots[area]??this.layout.guestSlots.breakroom;const [x,y]=points[index%points.length];return{x,y};}
  update(time){
    if(!this.ready)return;
    this.hoverPulseTime=time;
    for(const station of this.stations)if(station.player.sample(Math.max(0,time-station.epoch)))station.texture.refresh();
    const tick=Math.floor(time*12/1000);if(tick===this.lastSceneTick)return;this.lastSceneTick=tick;
    if(this.hoveredStation)this.drawSelection();
    const status=this.getStation(this.layout.mainStation).state;
    if(this.serverCabinetAnimation?.ready){
      // Keep legacy standalone maps working while telemetry mode supplies an
      // explicit cabinet state through setServerCabinetState().
      const legacy=status==='error'?'fault':status==='syncing'?'syncing':status==='idle'?'standby':'working';
      if(this.serverAnimationState===null)this.serverCabinetAnimation.setState(legacy,{source:'legacy-main-state'});
      this.serverCabinetAnimation.sample(time);
    }else{
      const color=status==='error'?0xbd6658:0x73bc9a;
      const alpha=this.reducedMotion?0.7:status==='idle'?0.35:tick%12<6?0.95:0.5;
      for(const led of this.serverLights)led.setFillStyle(color,alpha);
      const [x,y,w,h]=this.layout.server.bounds;this.serverWarning.clear();
      if(status==='error'){this.serverWarning.lineStyle(2,color,alpha);this.serverWarning.strokeRoundedRect(x,y,w,h,3);}
      const next=`设备间 · ${status==='error'?'异常':status==='syncing'?'同步':status==='idle'?'待命':'运行'}`;if(this.serverLabel.text!==next)this.serverLabel.setText(next);
    }
  }
  async replaceServer(asset,{baseUrl=this.baseUrl}={}){
    const image=new Image();image.src=new URL(asset,baseUrl).href;await image.decode();
    if(image.width<1||image.height<1)throw new Error('服务器素材无效');
    const key=`office-v3-server-${++this.serverVersion}`;this.scene.textures.addImage(key,image);
    const old=this.serverSprite.texture.key,[, ,w,h]=this.layout.server.bounds;this.serverSprite.setTexture(key).setDisplaySize(w,h);this.scene.textures.remove(old);this.emit();
  }
  async replaceCharacter(character,{baseUrl=this.baseUrl,stationId=this.activeStation}={}){
    const s=this.getStation(stationId),assets=structuredClone(this.assets);
    if(character.direction!==s.direction)throw new Error('替换角色必须与当前工位方向一致');
    const c=structuredClone(character);c.base=new URL(c.base,baseUrl).href;
    for(const action of Object.values(c.actions))if(action.frames)action.frames=new URL(action.frames,baseUrl).href;
    assets.directions[s.direction].character=c;
    const player=await new DirectionalSeatedPlayer(document.createElement('canvas'),assets,{baseUrl:this.baseUrl,direction:s.direction,reducedMotion:this.reducedMotion}).initialize();
    player.setState(s.state);player.sample(Math.max(0,this.scene.time.now-s.epoch));
    const old=s.textureKey,key=`office-v3-seat-${s.id}-${++s.version}`,texture=this.scene.textures.addCanvas(key,player.canvas);
    s.sprite.setTexture(key);s.player=player;s.texture=texture;s.textureKey=key;this.scene.textures.remove(old);this.characterVersion++;
    this.refreshAnchor(s);this.refreshBubble(s);this.refreshMain();this.emit();
  }
  snapshot(){
    const camera=this.scene?.cameras.main;
    return {annotationReflows:this.annotationReflows??0,renderQuality:this.renderQuality?.snapshot()??null,backgroundSourceSize:this.backgroundSourceSize??null,scene:this.layout.id,ready:this.ready,mapSize:this.layout.size,directionRule:this.layout.directionRule,animationMode:'full-frame',mainStation:this.layout.mainStation,activeStation:this.activeStation,view:this.view,demoMode:this.demoMode,state:this.state,stateEpoch:this.stateEpoch,faceAnchor:this.faceAnchor,player:this.player?.snapshot(),openSeatCount:16,privateSeatCount:0,walkIntegrated:false,characterVersion:this.characterVersion,
      camera:camera?{zoom:camera.zoom,worldView:[camera.worldView.x,camera.worldView.y,camera.worldView.width,camera.worldView.height]}:null,
      stations:this.stations.map(s=>({id:s.id,name:s.name,role:s.role,region:s.region,group:s.group,direction:s.direction,state:s.state,source:s.source,detail:s.detail,bound:s.bound,agentId:s.agentId,characterProfileId:s.characterProfileId??'orange-cat-v1',characterLabel:s.characterLabel??'橘猫',characterStatus:s.characterStatus??'ready',selected:s.id===this.activeStation,position:[...(s.center)],scale:s.scale,bubbleAnchor:s.bubbleAnchor,bubbleRect:s.bubbleRect,bubbleVisible:s.bubbleVisible,bubblePlacementClear:s.bubblePlacementClear,bubbleRelocated:s.bubbleRelocated,headAnchor:s.headAnchor,player:s.player?.snapshot()})),
      unplacedAgents:this.unplacedAgents,server:{version:this.serverVersion,bounds:this.layout.server.bounds,status:this.state,animationState:this.serverAnimationState??this.serverCabinetAnimation?.state??'standby',animationDetail:this.serverAnimationDetail??'',animationSource:this.serverAnimationSource??'local',animation:this.serverCabinetAnimation?.snapshot()??null},serverWarning:this.state==='error'||this.serverCabinetAnimation?.state==='fault',serverLabel:this.serverLabel?.text??''};
  }
}

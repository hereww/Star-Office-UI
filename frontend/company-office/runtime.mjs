import { SeatedOfficePlayer, BUSINESS_STATES } from './seated-compositor.mjs';

const STATE_LABELS = Object.freeze({
  idle: ['橘猫 · 呼呼大睡', 0x77999e], writing: ['橘猫 · 整理文档', 0x4e8580],
  researching: ['橘猫 · 搜索信息', 0x4e8580], executing: ['橘猫 · 执行任务', 0x4e8580],
  syncing: ['橘猫 · 等待同步', 0x438cad], error: ['橘猫 · 迷糊出错', 0xba6651]
});
const WORKSTATION_SIZE = 192;
async function readJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Office config unavailable (${response.status})`);
  return response.json();
}
export function stationBounds(station) {
  return [station.center[0] - 96, station.center[1] - 96, WORKSTATION_SIZE, WORKSTATION_SIZE];
}
export function rectanglesOverlap(a, b) {
  return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
}
function wallBounds([x1,y1,x2,y2]) {
  return [Math.min(x1,x2)-8, Math.min(y1,y2)-8, Math.abs(x2-x1)+16, Math.abs(y2-y1)+16];
}
function finiteRect(rect) { return Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite) && rect[2] > 0 && rect[3] > 0; }
function pointInOutline([x,y], outline) {
  let inside = false;
  for (let i=0,j=outline.length-1;i<outline.length;j=i++) {
    const [xi,yi]=outline[i], [xj,yj]=outline[j];
    if ((yi>y)!==(yj>y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}
export function validateLayout(layout) {
  if (!Array.isArray(layout.size) || layout.size.length !== 2 || !layout.size.every(v => Number.isInteger(v) && v >= 192 && v <= 8192)) throw new Error('地图尺寸无效');
  if (layout.directionRule !== 'cardinal-only') throw new Error('只接受上下左右平面地图');
  if (!Array.isArray(layout.stations) || !layout.stations.length) throw new Error('没有工位');
  const [width,height] = layout.size, ids = new Set();
  for (const station of layout.stations) {
    if (!station.id || ids.has(station.id)) throw new Error('重复或缺失的工位ID');
    ids.add(station.id);
    if (station.direction !== 'down' || station.scale !== 1) throw new Error('当前工位只支持原尺寸正面朝下');
    if (!Array.isArray(station.center) || station.center.length !== 2 || !station.center.every(Number.isFinite)) throw new Error('工位坐标无效');
    const [x,y] = station.center, bounds=stationBounds(station);
    if (x < 96 || x > width-96 || y < 96 || y > height-96) throw new Error('工位超出地图');
    if (layout.outline && [[x-96,y-96],[x+96,y-96],[x-96,y+96],[x+96,y+96]].some(p=>!pointInOutline(p,layout.outline))) throw new Error(`工位超出办公室轮廓: ${station.id}`);
    if ((layout.walls ?? []).some(w=>rectanglesOverlap(bounds,wallBounds(w)))) throw new Error(`工位叠墙: ${station.id}`);
    if ((layout.circulation ?? []).some(c=>rectanglesOverlap(bounds,c.bounds))) throw new Error(`工位占用主通道: ${station.id}`);
    if ((layout.doors ?? []).some(d=>rectanglesOverlap(bounds,d.bounds))) throw new Error(`工位占用门洞: ${station.id}`);
    if (station.room) {
      const room=(layout.rooms ?? []).find(r=>r.id===station.room);
      if (!room || !finiteRect(room.bounds) || x-96<room.bounds[0] || x+96>room.bounds[0]+room.bounds[2] || y-96<room.bounds[1] || y+96>room.bounds[1]+room.bounds[3]) throw new Error(`独立工位不在指定房间: ${station.id}`);
    }
  }
  for(let i=0;i<layout.stations.length;i++) for(let j=i+1;j<layout.stations.length;j++) if(rectanglesOverlap(stationBounds(layout.stations[i]),stationBounds(layout.stations[j]))) throw new Error('工位互相重叠');
  if (!ids.has(layout.mainStation)) throw new Error('主工位不存在');
  if (layout.source?.openSeatCount) {
    const open=layout.stations.filter(s=>s.kind==='open');
    if (open.length !== layout.source.openSeatCount) throw new Error('开放区工位数与原图不符');
    for (const [group,count] of Object.entries(layout.openSeatGroups ?? {})) if (open.filter(s=>s.group===group).length !== count) throw new Error(`工位分组数量不符: ${group}`);
  }
  if (!finiteRect(layout.server?.bounds) || !layout.server?.indicator?.every(Number.isFinite)) throw new Error('机房状态点无效');
  for(const points of Object.values(layout.guestSlots ?? {})) if (!points.length || points.some(p=>p.length!==2 || !p.every(Number.isFinite) || p[0]<0 || p[0]>width || p[1]<0 || p[1]>height)) throw new Error('访客点位无效');
  return layout;
}

/** Phaser adapter: immutable approved 192px furniture/actor contract, separate map world and camera viewport. */
export class CompanyOfficeRuntime {
  static async load(path, { layoutFile = 'map-layout.json' } = {}) {
    const baseUrl = new URL(path, location.href).href;
    const [layout,assets] = await Promise.all([readJson(new URL(layoutFile,baseUrl)),readJson(new URL('office-assets.json',baseUrl))]);
    const runtime = new CompanyOfficeRuntime(validateLayout(layout),assets,baseUrl);
    runtime.player = await new SeatedOfficePlayer(document.createElement('canvas'),assets,{baseUrl}).initialize();
    runtime.player.view = 'character'; runtime.player.setState('idle');
    return runtime;
  }
  constructor(layout,assets,baseUrl) {
    this.layout=layout; this.assets=assets; this.baseUrl=baseUrl;
    this.state='idle'; this.stateEpoch=0; this.lastTick=-1; this.characterVersion=0;
    this.stations=[]; this.textureKey='company-office-actor-0'; this.ready=false; this.view='overview';
  }
  preload(scene) { scene.load.image('office_bg',new URL(this.layout.background,this.baseUrl).href); }
  refreshFaceAnchor() {
    const main=this.layout.stations.find(s=>s.id===this.layout.mainStation), c=this.assets.character, seat=this.assets.workstation.seatAnchor;
    const [hx,hy]=c.headAnchor??[96,35];
    this.faceAnchor={x:main.center[0]-96+seat[0]+(hx-c.poseAnchor[0])*c.scale,y:main.center[1]-96+seat[1]+(hy-c.poseAnchor[1])*c.scale};
  }
  create(scene) {
    this.scene=scene;
    const [width,height]=this.layout.size;
    const background=scene.add.image(width/2,height/2,'office_bg').setDepth(-100);
    if(background.width!==width || background.height!==height) throw new Error('地图尺寸不匹配');
    scene.textures.addImage('company-office-chair',this.player.images.back);
    scene.textures.addImage('company-office-desk',this.player.images.front);
    this.actorTexture=scene.textures.addCanvas(this.textureKey,this.player.canvas);
    this.refreshFaceAnchor();
    for (const [index,spec] of this.layout.stations.entries()) {
      const [cx,cy]=spec.center;
      const back=scene.add.image(0,0,'company-office-chair').setOrigin(0);
      const front=scene.add.image(0,0,'company-office-desk').setOrigin(0), parts=[back];
      if(spec.id===this.layout.mainStation) { this.actor=scene.add.image(0,0,this.textureKey).setOrigin(0); parts.push(this.actor); }
      parts.push(front);
      const group=scene.add.container(cx-96,cy-96,parts).setDepth(cy+80);
      group.setData('companyOfficeLocked',true);
      this.stations.push({spec,group,back,front});
      const labelY=cy+95;
      if(spec.id===this.layout.mainStation) {
        this.badge=scene.add.rectangle(cx,labelY,184,26,0x4e8580).setDepth(cy+100);
        this.label=scene.add.text(cx,labelY,'',{fontFamily:'ArkPixel, monospace',fontSize:'15px',color:'#fff8e9'}).setOrigin(0.5).setDepth(cy+101);
      } else {
        const label=spec.kind==='private'?'独立工位':`工位 ${String(index+1).padStart(2,'0')}`;
        scene.add.text(cx,labelY,label,{fontFamily:'ArkPixel, monospace',fontSize:'13px',color:'#536e6b',backgroundColor:'#ead6b5',padding:{x:8,y:4}}).setOrigin(0.5).setDepth(cy+101);
      }
    }
    this.roomLabels=[];
    for(const spec of [...(this.layout.rooms ?? []).filter(r=>r.id!=='equipment'),...(this.layout.zones ?? [])]) {
      // Real-font labels are not baked into imagegen art; PDF areas are source annotations, not measured pixel scale.
      const text=spec.name;
      this.roomLabels.push(scene.add.text(...spec.label,text,{fontFamily:'ArkPixel, monospace',fontSize:'24px',color:'#315e5b',backgroundColor:'#eee0c7',padding:{x:12,y:6}}).setOrigin(0.5).setDepth(4000));
    }
    const [ix,iy]=this.layout.server.indicator;
    this.serverLabel=scene.add.text(ix,iy,'',{fontFamily:'ArkPixel, monospace',fontSize:'20px',color:'#325854',backgroundColor:'#ead6b5',padding:{x:8,y:5}}).setOrigin(0.5).setDepth(4000);
    const [x,y,w,h]=this.layout.server.bounds;
    this.serverWarning=scene.add.rectangle(x+w/2,y+h/2,w,h).setStrokeStyle(2,0xc36b48).setFillStyle(0xc36b48,0).setDepth(1).setVisible(false);
    this.serverLights=Array.from({length:3},(_,i)=>scene.add.rectangle(x+16,y+40+i*24,5,3,0x78ca9b).setDepth(1));
    this.ready=true; this.setState(this.state,true); this.update(scene.time.now);
    return background;
  }
  setView(view) {
    if(!['overview','workstation'].includes(view)) throw new Error('未知地图视图');
    this.view=view; this.applyView();
  }
  applyView() {
    if(!this.scene) return;
    const camera=this.scene.cameras.main, [w,h]=this.layout.size;
    const main=this.layout.stations.find(s=>s.id===this.layout.mainStation);
    const spec=this.layout.views?.[this.view];
    const center=this.view==='workstation' ? (spec?.center ?? main.center) : (spec?.bounds ? [spec.bounds[0]+spec.bounds[2]/2,spec.bounds[1]+spec.bounds[3]/2] : [w/2,h/2]);
    const span=this.view==='workstation' ? (spec?.span ?? [720,620]) : (spec?.bounds ? spec.bounds.slice(2) : [w,h]);
    const zoom=Math.min(camera.width/span[0],camera.height/span[1]);
    const padX=Math.max(0,(camera.width/zoom-w)/2),padY=Math.max(0,(camera.height/zoom-h)/2);
    camera.setBackgroundColor('#d7e2da');
    camera.setBounds(-padX,-padY,w+2*padX,h+2*padY); camera.setZoom(zoom); camera.centerOn(...center);
    const labelScale=Math.max(1,Math.round(11/(24*zoom)));
    for(const label of this.roomLabels ?? []) label.setScale(labelScale);
    this.serverLabel?.setScale(labelScale);
    // Phaser accounts for zoom's center origin itself. Never clamp its scroll using unzoomed viewport formulas.
  }
  setState(state,force=false) {
    if(!Object.hasOwn(BUSINESS_STATES,state)) state='idle';
    if(!force && state===this.state) return;
    this.state=state; this.stateEpoch=this.scene?.time.now ?? 0; this.lastTick=-1;
    this.player.setState(state); this.actorTexture?.refresh();
    if(this.label) {
      const [text,color]=STATE_LABELS[state]; this.label.setText(text); this.badge.setFillStyle(color);
      this.serverWarning.setVisible(state==='error');
      this.serverLabel.setText(state==='error'?'机房 · 异常':state==='syncing'?'机房 · 同步':state==='idle'?'机房 · 待命':'机房 · 运行');
    }
  }
  update(time) {
    if(!this.ready) return;
    const elapsed=Math.max(0,time-this.stateEpoch),tick=Math.floor(elapsed*this.assets.fps/1000);
    if(tick===this.lastTick) return;
    this.lastTick=tick; this.player.sample(elapsed); this.actorTexture.refresh();
    const alpha=this.state==='idle'?0.35:(tick%12<6?1:0.5);
    for(const led of this.serverLights) led.setFillStyle(this.state==='error'?0xe08051:0x78ca9b,alpha);
    this.serverWarning.setAlpha(tick%12<6?0.85:0.45);
  }
  guestPoint(area,index) {
    const points=this.layout.guestSlots[area] ?? this.layout.guestSlots.breakroom;
    const [x,y]=points[index%points.length]; return {x,y};
  }
  /** Load a prepared seated character completely before swapping; fixed furniture is never moved. */
  async replaceCharacter(character,{baseUrl=this.baseUrl}={}) {
    const candidateConfig={...structuredClone(this.assets),character:structuredClone(character)};
    candidateConfig.workstation.back=new URL(this.assets.workstation.back,this.baseUrl).href;
    candidateConfig.workstation.front=new URL(this.assets.workstation.front,this.baseUrl).href;
    const candidate=await new SeatedOfficePlayer(document.createElement('canvas'),candidateConfig,{baseUrl}).initialize();
    candidate.view='character'; candidate.setState(this.state); candidate.sample(Math.max(0,this.scene.time.now-this.stateEpoch));
    const nextKey=`company-office-actor-${++this.characterVersion}`,nextTexture=this.scene.textures.addCanvas(nextKey,candidate.canvas),oldKey=this.textureKey;
    this.actor.setTexture(nextKey); this.player=candidate; this.assets=candidateConfig; this.textureKey=nextKey; this.actorTexture=nextTexture;
    this.scene.textures.remove(oldKey); this.refreshFaceAnchor();
  }
  snapshot() {
    const camera=this.scene?.cameras.main;
    return {scene:this.layout.id,ready:this.ready,state:this.state,stateEpoch:this.stateEpoch,mapSize:this.layout.size,directionRule:this.layout.directionRule,mainStation:this.layout.mainStation,view:this.view,
      camera:camera?{zoom:camera.zoom,worldView:[camera.worldView.x,camera.worldView.y,camera.worldView.width,camera.worldView.height]}:null,
      openSeatCount:this.layout.stations.filter(s=>s.kind==='open').length,privateSeatCount:this.layout.stations.filter(s=>s.kind==='private').length,
      faceAnchor:this.faceAnchor,player:this.player.snapshot(),stations:this.stations.map(({spec,group,back,front})=>({id:spec.id,direction:spec.direction,position:[group.x,group.y],chair:[back.x,back.y],desk:[front.x,front.y],scale:[group.scaleX,group.scaleY]})),
      serverWarning:this.serverWarning?.visible ?? false,serverLabel:this.serverLabel?.text ?? '',characterVersion:this.characterVersion,walkIntegrated:false};
  }
}

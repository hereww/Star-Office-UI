import {ConnectedOfficeRuntime, BUSINESS_STATES, STATE_LABELS} from './runtime.mjs';
import {ReferenceOfficeRuntime} from '../reference-v3/runtime.mjs?v=20261026-02';
import {runtimeCharacterProfileId,isRuntimeReadyCharacterProfile} from '../character-profile-runtime.mjs';
import {safeRoomCharacters} from '../../office/model.mjs';
import {OFFICE_TEXT_FONT} from '../reference-v3/render-quality.mjs';
import {sourceToWorld} from './furniture-contract.mjs';
import {speechBubbleStatus} from '../../office/bubble-status.mjs';

/**
 * API_CONTRACT_V1: no polling, network writes or legacy /status /agents input.
 *   const runtime = await ConnectedOfficeRuntime.load(assetBase);
 *   runtime.preload(scene); runtime.create(scene); // frontend owns Phaser lifecycle
 *   const office = new OfficeRuntimeAdapter(runtime, {mode:'live'});
 *   office.applyTelemetrySnapshot(publicSnapshot);
 *   office.applyDisplaySettings(publicSnapshot.display);
 *   office.update(time, delta);
 *   await office.setDemoMode(true); // isolated local display, 16 actors
 *   office.setStationState('desk-12', 'writing');
 *   await office.setStationDirection('desk-12', 'left'); // preview ONLY
 *   await office.setDemoMode(false); // latest actual incl. elapsed freshness
 *   office.destroy(); // unregister adapter/runtime listeners and owned render objects
 *
 * preload/create and static load remain optional wrappers for a new loader; the
 * constructor ALSO supports attach-before-create. snapshot()/actualSnapshot are
 * detached copies, subscriptions return unsubscribe. No administrator IDs/data
 * beyond the expressly approved public username are retained. Public payload is the exact v1 snake_case contract; source or
 * concurrency failure is UNKNOWN, never error/idle activity. The internal player
 * still uses idle for neutral presentation, not a seventh business state.
 */
const DIRECTIONS = ['up','down','left','right'];
const clone = value => structuredClone(value);
function freeze(value){if(value && typeof value==='object'){Object.freeze(value);for(const v of Object.values(value))freeze(v);}return value;}
function timestamp(value){
  if(value==null)return null;
  if(typeof value==='number' && Number.isFinite(value))return value;
  if(typeof value==='string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)))return Date.parse(value);
  throw new Error('Invalid sample timestamp');
}
function count(value){
  if(value==null)return null;
  if(typeof value==='number' && Number.isSafeInteger(value) && value>=0)return String(value);
  if(typeof value==='string' && /^(0|[1-9]\d*)$/.test(value))return value;
  throw new Error('Concurrency must be a nonnegative lossless integer or null');
}
/** Identity observations have their own clock; never fill from alias/email/id. */
function projectIdentity(row, source, now){
  const observed=timestamp(row.identity_observed_at),success=timestamp(source.last_success_at);
  const ttl=3*source.poll_interval_seconds*1000;
  let quality=!row.bound?'unbound':source.status==='stale'?'stale':source.status!=='ok'?'unavailable':row.identity_quality??'unavailable';
  if(quality==='fresh'){
    if(observed===null||success===null||typeof row.username!=='string')quality='unavailable';
    else if(now-observed>=ttl||now-success>=ttl||observed-now>5000||success-now>5000)quality='stale';
  }
  return {username:quality==='fresh'?row.username:null,identity_quality:quality,
    identity_observed_at:row.bound&&observed!==null?new Date(observed).toISOString():null};
}
// Map callouts contain status only. Identities/counts remain in the details/list.
export function speechBubbleLines(station){return [speechBubbleStatus(station)];}
/** Greedy measured wrapping; preserve every glyph rather than eliding it. */
export function wrapSpeechBubbleText(value,measure,maxWidth){
  const lines=[];
  for(const paragraph of String(value).split('\n')){
    let line='';
    for(const glyph of Array.from(paragraph)){
      if(line&&measure(line+glyph)>maxWidth){lines.push(line);line=glyph;}
      else line+=glyph;
    }
    lines.push(line);
  }
  return lines;
}
export const SPEECH_BUBBLE_STYLE=Object.freeze({fill:0xf7f6f2,text:'#26443D',line:0xbc9759,
  floatPixels:0.6,periodMs:3500,feedbackMs:200,motionReservePixels:1.5,tailPixels:4});
/** Pure seek-safe motion: no tweens/timers and no actor clock coupling. */
export function sampleSpeechBubbleMotion(clock,time,reducedMotion=false){
  if(reducedMotion)return {offsetCss:0,feedback:0};
  const t=Math.max(0,time-clock.motionEpoch),elapsed=clock.feedbackAt===null?Infinity:Math.max(0,time-clock.feedbackAt);
  const feedback=elapsed<SPEECH_BUBBLE_STYLE.feedbackMs?Math.sin(Math.PI*elapsed/SPEECH_BUBBLE_STYLE.feedbackMs):0;
  return {offsetCss:SPEECH_BUBBLE_STYLE.floatPixels*Math.sin(t*2*Math.PI/SPEECH_BUBBLE_STYLE.periodMs+clock.phase)+0.5*feedback,feedback};
}
const intersects=(a,b)=>a[0]<b[0]+b[2]&&a[0]+a[2]>b[0]&&a[1]<b[1]+b[3]&&a[1]+a[3]>b[1];
const inflate=(r,n)=>[r[0]-n,r[1]-n,r[2]+2*n,r[3]+2*n];
const within=(r,v)=>r[0]>=v[0]&&r[1]>=v[1]&&r[0]+r[2]<=v[0]+v[2]&&r[1]+r[3]<=v[1]+v[3];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function segmentBox(a,b,padding){return [Math.min(a[0],b[0])-padding,Math.min(a[1],b[1])-padding,Math.abs(a[0]-b[0])+2*padding,Math.abs(a[1]-b[1])+2*padding];}
function speechLeader(rect,head,obstacles,_viewport,unit,side='above'){
  const motion=SPEECH_BUBBLE_STYLE.motionReservePixels*unit;
  const below=side==='below';
  const tip=[clamp(head[0],rect[0]+5*unit,rect[0]+rect[2]-5*unit),below?rect[1]-SPEECH_BUBBLE_STYLE.tailPixels*unit:rect[1]+rect[3]+SPEECH_BUBBLE_STYLE.tailPixels*unit];
  const containing=obstacles.filter(r=>head[0]>=r[0]&&head[0]<=r[0]+r[2]&&head[1]>=r[1]&&head[1]<=r[1]+r[3]);
  const end=[head[0],below?Math.max(head[1]+4*unit,...containing.map(r=>r[1]+r[3]+2*unit)):Math.min(head[1]-4*unit,...containing.map(r=>r[1]-2*unit))];
  // Short local pointers only; never route a status into another workstation.
  if(below?tip[1]-motion-unit<end[1]:tip[1]+motion+unit>end[1])return {tip,leader:null};
  const points=tip[0]===end[0]?[tip,end]:[tip,[tip[0],end[1]],end];
  const blocked=[...obstacles,inflate(rect,unit)];
  const clear=points.slice(1).every((p,i)=>{
    const box=segmentBox(points[i],p,unit);
    if(i===0){const y0=Math.min(points[i][1]-motion,p[1])-unit,y1=Math.max(points[i][1]+motion,p[1])+unit;box[1]=y0;box[3]=y1-y0;}
    return !blocked.some(r=>intersects(box,r));
  });
  return {tip,leader:clear?points:null};
}
/** Workstation-centred callouts. Rear-facing seats prefer the free space below
 * their actor, away from the central monitors. Other directions prefer above.
 * Both sides are considered locally; no distant global annotations or rails.
 */
export function layoutSpeechBubbles(items,viewport,obstacles=[],unit=1){
  const motion=SPEECH_BUBBLE_STYLE.motionReservePixels*unit,tail=SPEECH_BUBBLE_STYLE.tailPixels*unit;
  const safe=[viewport[0]+4*unit,viewport[1]+4*unit,viewport[2]-8*unit,viewport[3]-8*unit];
  const placed=[],results=new Map(),blocked=obstacles.map(r=>inflate(r,unit));
  const reserve=(r,side)=>[r[0]-unit,r[1]-motion-unit-(side==='below'?tail:0),r[2]+2*unit,r[3]+2*motion+tail+2*unit];
  for(const item of [...items].sort((a,b)=>a.head[1]-b.head[1]||a.head[0]-b.head[0]||a.id.localeCompare(b.id))){
    const {head,width:w,height:h}=item;
    const minX=safe[0]+2*unit,maxX=safe[0]+safe[2]-w-2*unit;
    if(maxX<minX||h+tail+2*motion+4*unit>safe[3]){results.set(item.id,{visible:false,reason:'viewport_packed'});continue;}
    const containing=blocked.filter(r=>head[0]>=r[0]&&head[0]<=r[0]+r[2]&&head[1]>=r[1]&&head[1]<=r[1]+r[3]);
    const edges={above:Math.min(head[1]-4*unit,...containing.map(r=>r[1]-2*unit)),below:Math.max(head[1]+4*unit,...containing.map(r=>r[1]+r[3]+2*unit))};
    const preferredX=head[0]-w/2,x=clamp(preferredX,minX,maxX),step=h+tail+2*motion+5*unit;
    if(Math.abs(x+w/2-head[0])>Math.max(w/2,12*unit)){results.set(item.id,{visible:false,reason:'anchor_clipped'});continue;}
    const obstaclesNow=[...blocked,...placed];let result=null;
    const sides=item.direction==='up'?['below','above']:['above','below'];
    for(const side of sides){
      const below=side==='below',preferredY=below?edges.below+tail+motion+3*unit:edges.above-h-tail-motion-3*unit;
      for(let row=0;row<=2&&row*step<=84*unit;row++){
        const rect=[x,preferredY+(below?1:-1)*row*step,w,h],reserved=reserve(rect,side);
        if(!within(reserved,safe)||obstaclesNow.some(r=>intersects(reserved,r)))continue;
        const route=speechLeader(rect,head,obstaclesNow,viewport,unit,side);if(!route.leader)continue;
        result={visible:true,rect,reserved,tip:route.tip,leader:route.leader,side,
          relocated:row>0||Math.abs(x-preferredX)>unit};break;
      }
      if(result)break;
    }
    if(result){placed.push(result.reserved);results.set(item.id,result);}else results.set(item.id,{visible:false,reason:'local_anchor_packed'});
  }
  return results;
}

export function normalizeTelemetrySnapshot(input, seatIds, {now=Date.now()}={}){
  if(input?.schema_version!==1 || !Array.isArray(input.stations) || input.stations.length!==seatIds.length)throw new Error('Complete public schema_version 1 snapshot required');
  const ids=new Set(seatIds),seen=new Set();
  const source=input.source;
  if(input.config_version!=null && (!Number.isSafeInteger(input.config_version)||input.config_version<0))throw new Error('Invalid config version');
  if(!source || !['connecting','ok','error','stale'].includes(source.status))throw new Error('Invalid public source');
  if(![5,10,30].includes(source.poll_interval_seconds))throw new Error('Invalid collection interval');
  const stations=input.stations.map(row=>{
    if(!row || !ids.has(row.seat_id) || seen.has(row.seat_id) || typeof row.bound!=='boolean')throw new Error('Invalid or duplicate seat binding');
    seen.add(row.seat_id);
    const quality=typeof row.quality==='object'?row.quality?.concurrency:row.quality;
    if(!['fresh','unavailable','untracked','stale','unbound'].includes(quality))throw new Error('Invalid concurrency quality');
    if(typeof row.display_name!=='string')throw new Error('Invalid display alias');
    const observed=timestamp(row.observed_at),current=row.bound?count(row.concurrency?.current):null;
    const limit=row.bound?count(row.concurrency?.limit):null;
    if(row.username!=null&&typeof row.username!=='string')throw new Error('Invalid public username');
    if(row.identity_quality!==undefined&&!['fresh','unavailable','stale','unbound'].includes(row.identity_quality))throw new Error('Invalid identity quality');
    if(row.identity_observed_at!=null&&typeof row.identity_observed_at!=='string')throw new Error('Invalid identity observation');
    const identity=projectIdentity({...row,identity_observed_at:row.identity_observed_at??null},source,now);
    const characterProfileId=runtimeCharacterProfileId(row.character_profile_id);
    return {seat_id:row.seat_id,bound:row.bound,display_name:row.display_name,...identity,
      activity:row.bound?(source.status==='ok'&&quality==='fresh'&&current!==null?(current==='0'?'idle':'busy'):'unknown'):'unbound',animation_state:row.bound&&source.status==='ok'&&quality==='fresh'&&current!==null?(current==='0'?'idle':'writing'):null,quality:row.bound?quality:'unavailable',
      concurrency:{current,limit},observed_at:row.bound&&observed!==null?new Date(observed).toISOString():null,
      data_age_seconds:row.bound&&Number.isFinite(row.data_age_seconds)&&row.data_age_seconds>=0?row.data_age_seconds:null,
      character_profile_id:characterProfileId,character_label:row.character_profile_id===characterProfileId&&typeof row.character_label==='string'?row.character_label.slice(0,40):'橘猫',character_status:row.character_profile_id===characterProfileId&&typeof row.character_status==='string'?row.character_status.slice(0,32):'ready'};
  });
  const rawAppearance=input.appearance;
  const appearance={character_profile_id:runtimeCharacterProfileId(rawAppearance?.character_profile_id),allow_fallback:false};
  const cabinetState=['cabinet_state','service_status','server_status','rack_state'].reduce((result,key)=>{
    const value=source?.[key];
    if(typeof value==='string'&&value.length<=32)result[key]=value;
    return result;
  },{});
  return freeze({schema_version:1,config_version:input.config_version??null,generated_at:input.generated_at==null?null:new Date(timestamp(input.generated_at)).toISOString(),
    source:{status:source.status,last_success_at:source.last_success_at==null?null:new Date(timestamp(source.last_success_at)).toISOString(),last_attempt_at:source.last_attempt_at==null?null:new Date(timestamp(source.last_attempt_at)).toISOString(),
      poll_interval_seconds:source.poll_interval_seconds,stale_after_seconds:3*source.poll_interval_seconds,error_code:null,...cabinetState},appearance,room_characters:safeRoomCharacters(input.room_characters),
    stations:seatIds.map(id=>stations.find(row=>row.seat_id===id))});
}

/**
 * Translate the frozen Sub2API user-telemetry source health into the rack's
 * independent animation state. The current plugin contract exposes source
 * health (`ok`, `error`, `stale`, `connecting`) rather than a cabinet field;
 * optional future `cabinet_state`/`service_status` values are accepted here so
 * the UI can adopt that field without another release. Unknown or missing
 * values stay visibly unknown instead of pretending the service is running.
 */
export function serverCabinetStateFromTelemetry(snapshot) {
  const source=snapshot?.source??{};
  const explicit=String(source.cabinet_state??source.service_status??source.server_status??source.rack_state??'').toLowerCase();
  if(['working','running','online','ready','ok'].includes(explicit))return 'working';
  if(['fault','error','failed','unavailable','degraded'].includes(explicit))return 'fault';
  if(['shutdown','stopped','offline','disabled','halted'].includes(explicit))return 'shutdown';
  if(explicit==='idle')return 'standby';
  if(['syncing','connecting'].includes(explicit))return explicit==='syncing'?'syncing':'shutdown';
  if(source.status==='ok')return 'working';
  if(source.status==='error'){
    if(['not_configured','credential_expired','forbidden','unauthorized'].includes(source.error_code))return 'shutdown';
    return 'fault';
  }
  if(source.status==='stale')return 'unknown';
  if(source.status==='connecting')return 'shutdown';
  return 'unknown';
}

export function serverCabinetDetailFromTelemetry(snapshot,state=serverCabinetStateFromTelemetry(snapshot)) {
  const source=snapshot?.source??{};
  if(state==='working')return 'Sub2API 遥测连接正常';
  if(state==='standby')return 'Sub2API 在线 · 当前无请求';
  if(state==='fault')return source.error_code?`Sub2API 遥测异常 · ${source.error_code}`:'Sub2API 遥测异常';
  if(state==='shutdown')return source.status==='connecting'?'Sub2API 正在连接':'Sub2API 已停机';
  if(source.status==='stale')return 'Sub2API 遥测过期 · 状态未知';
  return 'Sub2API 状态未知';
}

/** Preserve the selected V4/V5 runtime prototype; never downgrade a V5 player. */
export function createOfficeRuntimeAdapter(RuntimeClass) {
  if (typeof RuntimeClass !== 'function' || !(RuntimeClass.prototype instanceof ReferenceOfficeRuntime)) throw new Error('Connected runtime class required');
class TelemetryOfficeRuntime extends RuntimeClass {
  setMainStatus(){throw new Error('Legacy status input is disabled in telemetry mode');}
  syncAgents(){throw new Error('Legacy agents input is disabled in telemetry mode');}
  setState(){throw new Error('Use applyTelemetrySnapshot, not legacy state input');}
  setDemoMode(enabled){return this.adapter.setPreview(enabled);}
  setStationState(id,state){return this.adapter.setPreviewState(id,state);}
  setStationDirection(id,direction){return this.adapter.setStationDirection(id,direction);}
  emit(){if(this.adapter)this.adapter._emit();else super.emit();}
  refreshBubble(station){if(this.adapter)this.adapter._layoutSpeechBubbles();else super.refreshBubble(station);}
  layoutClearBubbles(){if(this.adapter)this.adapter._layoutSpeechBubbles();else super.layoutClearBubbles();}
  selectStation(id,{focus=false}={}){
    this.getStation(id);this.activeStation=id;
    if(focus){this.view='workstation';this.applyView();}
    else {this.drawSelection();this.layoutClearBubbles();}
    this.emit();
  }
  // Keep exactly the original annotation/camera fitting, without old DOM controls.
  applyView(){
    if(!this.scene)return;
    const camera=this.scene.cameras.main,[w,h]=this.layout.size,s=this.getStation(this.activeStation),spec=this.layout.views[this.view];
    const center=this.view==='workstation'?s.center:spec.center,span=spec.span;
    const inset=this.renderQuality && this.renderQuality.measurement.cssSize[1]<420 && this.view!=='overview'?56*this.renderQuality.density:0;
    const zoom=Math.min(camera.width/span[0],Math.max(1,camera.height-inset)/span[1]);
    const padx=Math.max(0,(camera.width/zoom-w)/2),pady=Math.max(0,(camera.height/zoom-h)/2);
    camera.setBackgroundColor('#20252c');camera.setBounds(-padx,-pady,w+2*padx,h+2*pady);camera.setZoom(zoom);camera.centerOn(center[0],center[1]-inset/(2*zoom));
    if(this.renderQuality){
      const size=this.roomLabelFontSize();
      for(const label of this.roomLabels??[])this.renderQuality.styleText(label,size);
      if(this.entryLabel)this.renderQuality.styleText(this.entryLabel,size);
      if(this.serverLabel)this.renderQuality.styleText(this.serverLabel,Math.min(13,size));
      this.layoutClearBubbles();
    }else for(const station of this.stations)this.refreshBubble(station);
    for(const label of this.roomLabels??[])if(label._officeZone)label.setVisible(this.view==='overview');
    this.adapter?._applyVisibility();this.drawSelection();
  }
  update(time){
    // Do not invoke Connected.update: unknown screens must not animate as idle.
    ReferenceOfficeRuntime.prototype.update.call(this,time);
    if(!this.ready)return;
    for(const overlay of this.screenOverlays??[]){
      const station=this.getStation(overlay.screen.seatId),staticSeat=station.presentation?.neutral || !station.presentation?.actorVisible;
      overlay.sample(station.state,staticSeat?0:Math.max(0,time-station.epoch),staticSeat || this.reducedMotion);
    }
    const main=this.getStation(this.layout.mainStation);
    // A live rack state is independent from the main seat. Only use the
    // neutral fallback before the first validated rack status arrives.
    if((main.presentation?.neutral || !main.presentation?.actorVisible)
      && (!this.serverAnimationState || this.serverAnimationState==='unknown'))
      this.serverLabel?.setText('设备间 · 状态未知');
  }
}

class OfficeRuntimeAdapter {
  static async load(path,options={}){
    const runtime=await TelemetryOfficeRuntime.load(path);
    return new OfficeRuntimeAdapter(runtime,options);
  }
  /** Constructor also accepts an initialized selected runtime for isolated test hosts. */
  constructor(runtime,{mode='live',now=()=>Date.now()}={}){
    if(!(runtime instanceof RuntimeClass))throw new Error('ConnectedOfficeRuntime required');
    if(!['live','preview'].includes(mode)||typeof now!=='function')throw new Error('Invalid adapter options');
    if(runtime.adapter)throw new Error('Runtime already has an adapter');
    // Adopting only this instance does not alter ConnectedOfficeRuntime.prototype.
    Object.setPrototypeOf(runtime,TelemetryOfficeRuntime.prototype);
    this.runtime=runtime;runtime.adapter=this;this.now=now;this.mode=mode;
    this.listeners=new Set();this.destroyed=false;this.preview=false;this.previewVersion=0;
    this.settings={default_view:runtime.view??'overview',show_bubbles:true,show_labels:true,details_collapsed:false,reduced_motion:'system'};
    this.actuals=new Map();this.bubbleClocks={live:new Map(),preview:new Map()};this.originalDirections=new Map(runtime.stations.map(s=>[s.id,s.direction]));
    this._actualReceivedAt=this.now();
    this._actualSnapshot=normalizeTelemetrySnapshot({schema_version:1,source:{status:'connecting',poll_interval_seconds:5},stations:runtime.stations.map(s=>({
      seat_id:s.id,bound:s.id==='desk-12',display_name:s.id==='desk-12'?'主工位':'未绑定',quality:s.id==='desk-12'?'unavailable':'unbound',
      concurrency:{current:null,limit:null},observed_at:null
    }))},runtime.stations.map(s=>s.id));
    // Source constructors reserve a legacy main agent; replace that immediately.
    this._reconcile();
    this.systemMotionQuery=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.systemMotionHandler=()=>{if(this.settings.reduced_motion==='system')this._applyMotion();};
    runtime.motionQuery?.removeEventListener('change',runtime.motionHandler);
    this.systemMotionQuery?.addEventListener('change',this.systemMotionHandler);
    if(runtime.ready)this._attachCreatedScene();
    if(mode==='preview')void this.setDemoMode(true);
  }
  _attachCreatedScene(){
    const r=this.runtime,scene=r.scene;
    this.sceneObjects=[r.background,r.selection,r.entryLabel,r.serverSprite,r.serverWarning,r.serverLabel,r.serverCabinetAnimation?.overlay,
      ...(r.roomLabels??[]),...(r.serverLights??[]),...r.stations.flatMap(s=>[s.sprite,s.bubbleBackground,s.bubbleText]),
      ...(r.benches??[]).map(b=>b.sprite),...(r.screenOverlays??[]).flatMap(o=>o.components.map(c=>c.sprite))].filter(Boolean);
    this.renderQualityGlobal=globalThis.window?.officeRenderQuality;
    // The loader may mask the entire legacy render before attaching. Restore
    // chair-bearing sprites/hardware, NOT unbound actor drawing.
    for(const station of r.stations)station.sprite?.setVisible(true);
    for(const overlay of r.screenOverlays??[])for(const part of overlay.components)part.sprite?.setVisible(true);
    for(const led of r.serverLights??[])led.setVisible(true);
    r.serverCabinetAnimation?.overlay?.setVisible(true);
    this.shutdownHandler=()=>this.destroy();scene.events.once('shutdown',this.shutdownHandler);
    r.layoutClearBubbles();r.refreshMain();r.update(scene.time.now);
  }
  _assertLive(){if(this.destroyed)throw new Error('Office adapter is destroyed');}
  _invalidateIdentityCache(){
    const now=this.now(),source=this._actualSnapshot.source;
    let changed=false;
    const stations=this._actualSnapshot.stations.map(row=>{
      const identity=projectIdentity(row,source,now);
      if(identity.username!==row.username||identity.identity_quality!==row.identity_quality){changed=true;return {...row,...identity};}
      return row;
    });
    if(changed)this._actualSnapshot=freeze({...this._actualSnapshot,stations});
  }
  get actualSnapshot(){this._invalidateIdentityCache();return clone(this._actualSnapshot);}
  applyTelemetrySnapshot(wire){
    this._assertLive();
    const next=normalizeTelemetrySnapshot(wire,this.runtime.stations.map(s=>s.id),{now:this.now()});
    this._actualSnapshot=next;this._actualReceivedAt=this.now();this.runtime.setRoomCharacterVisibility?.(next.room_characters);this._reconcile();this._emit();return this.snapshot();
  }
  /** Local poll failure seam; preserves bindings/sample times but never zero-fills. */
  markUnavailable(){
    this._assertLive();this._actualSnapshot=freeze({...clone(this._actualSnapshot),source:{...this._actualSnapshot.source,status:'error'}});
    this._reconcile();this._emit();
  }
  _reconcile(){
    this._invalidateIdentityCache();
    const r=this.runtime,clock=r.scene?.time.now??0,now=this.now(),rows=new Map(this._actualSnapshot.stations.map(s=>[s.seat_id,s]));
    let changed=false;
    for(const station of r.stations){
      const row=rows.get(station.id),bound=!!row?.bound,current=row?.concurrency.current??null;
      const sample=timestamp(row?.observed_at),localAge=sample===null?null:now-sample;
      const age=localAge===null?null:Math.max(localAge,(row.data_age_seconds??0)*1000+Math.max(0,now-this._actualReceivedAt));
      let quality=!bound?'unbound':this._actualSnapshot.source.status!=='ok'?(this._actualSnapshot.source.status==='stale'?'stale':'unavailable'):row.quality;
      if(bound && quality==='fresh' && (age===null||age>=this._actualSnapshot.source.stale_after_seconds*1000||localAge < -5000))quality='stale';
      if(bound && quality==='fresh' && current===null)quality='unavailable';
      const state=quality==='fresh'&&current!=='0'?'writing':'idle';
      const previous=this.actuals.get(station.id);
      const label=quality==='unbound'?'未绑定':quality==='fresh'?(state==='writing'?`处理中 · 并发 ${current}`:'待命'):quality==='untracked'?'数据未跟踪':quality==='stale'?'数据过期 · 状态未知':'状态未知';
      const data={name:bound?(row.display_name||'同事'):(row.display_name||'未绑定'),state,detail:label,source:bound?'telemetry':'unbound',bound,agentId:null,
        quality,current:quality==='fresh'?current:null,...projectIdentity(row??{bound:false},this._actualSnapshot.source,now),characterProfileId:row?.character_profile_id||this._actualSnapshot.appearance?.character_profile_id||'orange-cat-v1',characterLabel:row?.character_label||'橘猫',characterStatus:row?.character_status||'ready',sampledAt:sample,presentation:{actorVisible:bound,neutral:quality!=='fresh'},
        epoch:previous && previous.state===state?previous.epoch:clock};
      const seatChanged=JSON.stringify(previous)!==JSON.stringify(data);
      if(seatChanged)changed=true;
      this.actuals.set(station.id,data);station.actual=clone(data);this._syncBubbleClock(station.id,data,'live');
      if(!this.preview){if(seatChanged || this._restoreActual)this._display(station,data);else this._requestCharacter(station,data.characterProfileId);}
    }
    if(!this.preview && typeof r.setServerCabinetState==='function'){
      const state=serverCabinetStateFromTelemetry(this._actualSnapshot);
      r.setServerCabinetState(state,{source:'sub2api',detail:serverCabinetDetailFromTelemetry(this._actualSnapshot,state)});
    }
    if(changed && r.ready && !this.preview){r.layoutClearBubbles();r.refreshMain();r.drawSelection();}
    return changed;
  }
  _display(station,data){
    const previous=station.presentation,wasState=station.state;
    Object.assign(station,clone(data));
    this._syncBubbleClock(station.id,data,station.source==='demo'?'preview':'live');
    this._requestCharacter(station,data.characterProfileId);
    station.player.setPresentation(data.presentation);
    if(wasState!==data.state)station.player.setState(data.state);
    // Sampling current elapsed time retains other seats' independent clocks.
    const drew=station.player.sample(Math.max(0,(this.runtime.scene?.time.now??0)-station.epoch));
    if(drew||wasState!==data.state||JSON.stringify(previous)!==JSON.stringify(data.presentation))station.texture?.refresh();
  }
  _requestCharacter(station,profileId){
    const r=this.runtime;
    if(!r.setStationCharacterProfile||!isRuntimeReadyCharacterProfile(profileId)||station.renderedCharacterProfileId===profileId&&station.requestedCharacterProfileId===profileId&&!station.characterProfilePending||station.characterProfilePending?.id===profileId)return;
    const now=this.now();
    if(station.characterRetryId===profileId&&now<(station.characterRetryAt??0))return;
    station.characterRetryId=profileId;station.characterRetryAt=now+5000;
    void r.setStationCharacterProfile(station.id,profileId).then(changed=>{if(!this.destroyed&&changed){station.characterRetryAt=0;this._emit();}}).catch(()=>{if(!this.destroyed&&station.requestedCharacterProfileId===profileId){station.characterRetryAt=this.now()+5000;this._emit();}});
  }
  preload(scene){this._assertLive();return this.runtime.preload(scene);}
  create(scene){
    this._assertLive();if(this.runtime.ready)throw new Error('Scene already created');
    const background=this.runtime.create(scene);
    this.runtime.motionQuery?.removeEventListener('change',this.runtime.motionHandler);
    this._attachCreatedScene();return background;
  }
  update(time,delta){this._assertLive();const changed=this._reconcile();this.runtime.update(time,delta);this._drawSpeechBubbles(time);if(changed)this._emit();}
  selectStation(id,options={}){this._assertLive();this.runtime.selectStation(id,options);}
  setView(view){this._assertLive();this.runtime.setView(view);}
  applyDisplaySettings(display){
    this._assertLive();
    const allowed=['default_view','show_bubbles','show_labels','details_collapsed','reduced_motion'];
    for(const key of Object.keys(display))if(!allowed.includes(key))throw new Error(`Unknown display setting: ${key}`);
    const next={...this.settings,...display};
    for(const key of ['show_bubbles','show_labels','details_collapsed'])if(typeof next[key]!=='boolean')throw new Error(`Invalid ${key}`);
    if(!['overview','west','east','workstation'].includes(next.default_view)||!['system','on','off'].includes(next.reduced_motion))throw new Error('Invalid display setting');
    const viewChanged=next.default_view!==this.settings.default_view;
    this.settings=next;this._applyMotion();
    if(viewChanged)this.runtime.setView(next.default_view);
    this.runtime.layoutClearBubbles();this._applyVisibility();this._emit();
  }
  _applyMotion(){
    const r=this.runtime;r.reducedMotion=this.settings.reduced_motion==='on'||this.settings.reduced_motion==='system'&&!!this.systemMotionQuery?.matches;
    for(const station of r.stations){station.player.reducedMotion=r.reducedMotion;station.texture?.refresh();}
    r.serverCabinetAnimation?.setReducedMotion(r.reducedMotion);
    this._drawSpeechBubbles(r.scene?.time.now??0,true);
  }
  _syncBubbleClock(id,data,mode){
    const records=this.bubbleClocks[mode],lines=speechBubbleLines({...data,id}),key=JSON.stringify(lines),time=this.runtime.scene?.time.now??0;
    let record=records.get(id);
    if(!record){
      const index=this.runtime.stations.findIndex(s=>s.id===id);
      record={motionEpoch:time,phase:index*0.73,feedbackAt:null,key,lines};records.set(id,record);
    }else if(record.key!==key){record.key=key;record.lines=lines;record.feedbackAt=time;}
    return record;
  }
  _prepareBubble(station,unit,viewportWidth,pitch=Infinity){
    const text=station.bubbleText,mode=station.source==='demo'?'preview':'live',clock=this.bubbleClocks[mode].get(station.id);
    if(!text||!clock)return null;
    if(!text._speechBubble){
      text._speechBubble=true;
      text.setStyle({fontFamily:OFFICE_TEXT_FONT,color:SPEECH_BUBBLE_STYLE.text,align:'center',padding:{x:0,y:0},fontStyle:'normal'});
      text.setPadding?.(0);text.setLineSpacing(0);text.setOrigin(0.5);
    }
    const r=this.runtime,availableCss=viewportWidth/unit,pitchCss=pitch/unit;
    // Bound by the seat pitch in CSS pixels at every zoom/fullscreen/DPR.
    const maxBodyCss=Math.min(84,availableCss-16,Math.max(40,pitchCss-8));
    const metricsKey=JSON.stringify([clock.key,unit,r.renderQuality.density,maxBodyCss,r.renderQuality.textScale]);
    if(clock.metricsKey!==metricsKey){
      const size=10;r.renderQuality.styleText(text,size);
      const measure=value=>text.context.measureText(value).width*text.scaleX;
      const maxTextWidth=Math.max(unit,(maxBodyCss-10)*unit);
      const lines=clock.lines.flatMap(value=>wrapSpeechBubbleText(value,measure,maxTextWidth));
      const content=lines.join('\n');if(text.text!==content)text.setText(content);
      clock.metricsKey=metricsKey;clock.fontSize=size;clock.renderedLines=lines;
    }else r.renderQuality.styleText(text,clock.fontSize);
    return {id:station.id,head:station.headAnchor,direction:station.direction,width:text.displayWidth+10*unit,height:text.displayHeight+6*unit};
  }

  _layoutSpeechBubbles(){
    const r=this.runtime;if(!r.ready||!r.renderQuality||this._speechLayout)return;
    this._speechLayout=true;
    try{
      const cam=r.scene.cameras.main,unit=r.renderQuality.density/cam.zoom;
      const viewport=[cam.scrollX+cam.width/2-cam.width/(2*cam.zoom),cam.scrollY+cam.height/2-cam.height/(2*cam.zoom),cam.width/cam.zoom,cam.height/cam.zoom];
      const visibleHeads=r.stations.filter(s=>s.presentation?.actorVisible&&s.headAnchor);
      const heads=visibleHeads.map(s=>[s.headAnchor[0]-30*s.scale,s.headAnchor[1]-2*s.scale,60*s.scale,56*s.scale]);
      const screens=[];
      for(const record of r.benches??[])for(const screen of record.manifest.screens){
        if(screen.polygon?.length){const points=screen.polygon.map(p=>sourceToWorld(record.transform,p)),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);screens.push([Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)]);}
        if(screen.led){const [x,y,w=2,h=2]=screen.led,[wx,wy]=sourceToWorld(record.transform,[x,y]);screens.push([wx,wy,w*record.transform.scale,h*record.transform.scale]);}
      }
      r.screenProtectionRects=screens;
      const labels=this.settings.show_labels?[...(r.roomLabels??[]),r.entryLabel,r.serverLabel].filter(l=>l&&(!l._officeZone||r.view==='overview')).map(l=>[l.x-l.displayWidth/2,l.y-l.displayHeight/2,l.displayWidth,l.displayHeight]):[];
      const items=this.settings.show_bubbles?visibleHeads.filter(s=>within([s.headAnchor[0],s.headAnchor[1],0,0],viewport)).map(s=>{const pitch=Math.min(Infinity,...visibleHeads.filter(other=>other!==s&&Math.abs(other.headAnchor[1]-s.headAnchor[1])<40*unit).map(other=>Math.abs(other.headAnchor[0]-s.headAnchor[0])));return this._prepareBubble(s,unit,viewport[2],pitch);}).filter(Boolean):[];
      const key=JSON.stringify([viewport,unit,screens,heads,labels,items.map(i=>[i.id,i.head,i.width,i.height]),this.settings.show_bubbles,this.preview]);
      if(key!==this._speechLayoutKey){
        this._speechLayoutKey=key;// Compact callouts take priority over room captions: they are anchored to a live workstation,
        // while captions are secondary and may sit behind a bubble at overview scale.
        const placements=layoutSpeechBubbles(items,viewport,[...screens,...heads],unit);
        for(const s of r.stations){
          s.speechPlacement=placements.get(s.id)??{visible:false,reason:'outside_view'};
          s.bubbleVisible=!!s.speechPlacement.visible;s.bubblePlacementClear=s.bubbleVisible;s.bubbleScreenClear=true;
          s.bubbleRelocated=!!s.speechPlacement.relocated;s.bubbleScreenRelocated=s.bubbleRelocated;
        }
        r._annotationCamera=r.annotationCameraSignature();r._annotationLayoutAt=r.scene.time.now;r.annotationReflows=(r.annotationReflows??0)+1;
      }
      this._drawSpeechBubbles(r.scene.time.now,true);this._applyVisibility();
    }finally{this._speechLayout=false;}
  }
  _drawSpeechBubbles(time,force=false){
    const r=this.runtime;if(!r.ready||!r.renderQuality)return;
    const unit=r.renderQuality.density/r.scene.cameras.main.zoom;
    for(const s of r.stations){
      const placement=s.speechPlacement,g=s.bubbleBackground,text=s.bubbleText,clock=this.bubbleClocks[s.source==='demo'?'preview':'live'].get(s.id);
      if(!g||!text||!clock)continue;
      const visible=this.settings.show_bubbles&&!!s.presentation?.actorVisible&&!!placement?.visible;
      text.setVisible(visible);g.setVisible(visible);s.bubbleVisible=visible;
      if(!visible)continue;
      const motion=sampleSpeechBubbleMotion(clock,time,r.reducedMotion);
      const key=JSON.stringify([Math.round(motion.offsetCss*60),Math.round(motion.feedback*60),s.id===r.activeStation,placement.rect,placement.side,clock.key,r.reducedMotion]);
      if(!force&&key===clock.drawKey)continue;clock.drawKey=key;
      const [x,baseY,w,h]=placement.rect,y=baseY+motion.offsetCss*unit,tail=SPEECH_BUBBLE_STYLE.tailPixels*unit;
      const tip=[placement.tip[0],placement.tip[1]+motion.offsetCss*unit];
      const leader=placement.leader.map((point,i)=>i===0?tip:point);
      g.clear();g.lineStyle((s.id===r.activeStation?1.4:1)*unit, SPEECH_BUBBLE_STYLE.line,0.95);
      g.beginPath();g.moveTo(...leader[0]);for(const p of leader.slice(1))g.lineTo(...p);g.strokePath();
      g.fillStyle(SPEECH_BUBBLE_STYLE.fill,0.99);g.fillRoundedRect(x,y,w,h,5*unit);
      g.lineStyle((s.id===r.activeStation?1.4:1+0.25*motion.feedback)*unit,SPEECH_BUBBLE_STYLE.line,1);g.strokeRoundedRect(x,y,w,h,5*unit);
      // Rear seats point upwards; the pointer remains attached during motion.
      const below=placement.side==='below',edgeY=below?y:y+h,insideY=below?y+unit:y+h-unit;
      g.fillStyle(SPEECH_BUBBLE_STYLE.fill,1);g.fillTriangle(tip[0]-3*unit,insideY,tip[0]+3*unit,insideY,tip[0],below?y-tail:y+h+tail);
      g.beginPath();g.moveTo(tip[0]-3*unit,edgeY);g.lineTo(...tip);g.lineTo(tip[0]+3*unit,edgeY);g.strokePath();
      text.setPosition(x+w/2,y+h/2);
      s.bubbleRect=[x,y,w,h];s.bubbleAnchor=[x+w/2,y+h/2];s.bubbleLeader=leader;s.bubbleMotion={...motion,motionEpoch:clock.motionEpoch,feedbackAt:clock.feedbackAt};
    }
  }
  _applyVisibility(){
    const r=this.runtime;
    for(const station of r.stations){
      if(!station.presentation?.actorVisible||!this.settings.show_bubbles){
        station.bubbleVisible=false;station.bubbleText?.setVisible(false);station.bubbleBackground?.setVisible(false);
      }
    }
    const compactOverview=r.view==='overview'&&r.roomLabelFontSize()<14;
    for(const label of [...(r.roomLabels??[]),r.entryLabel,r.serverLabel].filter(Boolean))
      label.setVisible(this.settings.show_labels&&!compactOverview&&(!label._officeZone||r.view==='overview'));
  }
  setDemoMode(enabled){return this.setPreview(enabled);}
  setStationState(id,state){return this.setPreviewState(id,state);}
  setStationDirection(id,direction){
    this._assertLive();if(!this.preview)throw new Error('Directions are locked in live mode');
    return this.setPreview(true,{stationId:id,direction});
  }
  async setPreview(enabled,{stationId=null,state=null,direction=null}={}){
    this._assertLive();
    if(typeof enabled!=='boolean'||(state!==null&&!Object.hasOwn(BUSINESS_STATES,state))||(direction!==null&&!DIRECTIONS.includes(direction)))throw new Error('Invalid preview');
    if(stationId!==null)this.runtime.getStation(stationId);
    const version=++this.previewVersion,r=this.runtime,clock=r.scene?.time.now??0;
    this.preview=enabled;r.demoMode=enabled;
    if(enabled){
      const states=Object.keys(BUSINESS_STATES);
      for(const [i,station] of r.stations.entries()){
        const apply=stationId===null||station.id===stationId;
        const nextState=apply&&state!==null?state:station.source==='demo'?station.state:states[i%states.length];
        this._display(station,{name:`演示 ${i+1}`,username:null,identity_quality:'unavailable',identity_observed_at:null,
          state:nextState,source:'demo',detail:'演示 · 不提交后端',bound:false,agentId:null,quality:'demo',current:null,
          presentation:{actorVisible:true,neutral:false},epoch:station.state===nextState?station.epoch:clock});
      }
    }
    const targets=r.stations.filter(s=>!enabled||direction!==null&&(stationId===null||s.id===stationId));
    await Promise.all(targets.map(async station=>{
      const nextDirection=enabled?direction:this.originalDirections.get(station.id);
      let player=station.player;
      await player.setDirection(nextDirection);
      if(this.destroyed||version!==this.previewVersion)return;
      // A profile may have committed while the previous player's direction loaded.
      while(player!==station.player){player=station.player;await player.setDirection(nextDirection);if(this.destroyed||version!==this.previewVersion)return;}
      station.direction=player.direction;
      // In contrast to runtime.commitPlayer, directions never recompute seat centers.
      r.attachPlayerToBench(station,station.player);r.refreshAnchor(station);station.texture?.refresh();
    }));
    if(this.destroyed||version!==this.previewVersion)return;
    if(!enabled){this._restoreActual=true;try{this._reconcile();}finally{this._restoreActual=false;}}
    r.layoutClearBubbles();r.refreshMain();r.drawSelection();this._emit();return this.snapshot();
  }
  setPreviewState(id,state){
    this._assertLive();if(!this.preview)throw new Error('Explicit preview required');
    if(!Object.hasOwn(BUSINESS_STATES,state))throw new Error('Only six business states supported');
    const station=this.runtime.getStation(id);
    this._display(station,{name:station.name,state,detail:station.detail,username:null,identity_quality:'unavailable',identity_observed_at:null,source:'demo',bound:false,agentId:null,quality:'demo',current:null,epoch:station.state===state?station.epoch:this.runtime.scene?.time.now??0,presentation:{actorVisible:true,neutral:false}});
    this.runtime.layoutClearBubbles();this.runtime.refreshMain();this._emit();
  }
  subscribe(listener){this._assertLive();if(typeof listener!=='function')throw new Error('Listener required');this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  _emit(){
    if(this.destroyed)return;
    // The isolated frontend loader observes selections through this event.
    if(globalThis.window && typeof globalThis.CustomEvent==='function')
      globalThis.window.dispatchEvent(new CustomEvent('office-runtime-change',{detail:this.runtime}));
    if(this.listeners.size){const snapshot=this.snapshot();for(const listener of this.listeners)listener(clone(snapshot));}
  }
  snapshot(){
    const actual=this.actualSnapshot,identities=new Map(actual.stations.map(row=>[row.seat_id,row]));
    const runtimeSnapshot=this.runtime.snapshot();
    return {mode:this.preview?'preview':'live',demo:this.preview,settings:clone(this.settings),actualSnapshot:this.actualSnapshot,
      ...runtimeSnapshot,stations:runtimeSnapshot.stations.map(row=>{
        const station=this.runtime.getStation(row.id),identity=identities.get(row.id);
        const observation=timestamp(identity?.observed_at),ttl=this._actualSnapshot.source.stale_after_seconds*1000;
        const concurrentFresh=station.quality==='fresh'&&this._actualSnapshot.source.status==='ok'&&observation!==null&&this.now()-observation<ttl&&observation-this.now()<=5000;
        const publicQuality=concurrentFresh?'fresh':station.quality==='fresh'?'stale':station.quality;
        const publicLines=speechBubbleLines({...station,quality:publicQuality,current:concurrentFresh?station.current:null});
        const bubbleClock=this.bubbleClocks[station.source==='demo'?'preview':'live'].get(row.id);
        return {...row,seat_id:row.id,display_name:row.name,activity:station.source==='demo'?'demo':!station.bound?'unbound':station.quality!=='fresh'?'unknown':station.state==='writing'?'busy':'idle',animation_state:station.quality==='fresh'?station.state:null,quality:station.quality,current:station.current??null,username:station.source==='demo'?null:identities.get(row.id)?.username??null,identity_quality:station.source==='demo'?'unavailable':identities.get(row.id)?.identity_quality??'unavailable',identity_observed_at:station.source==='demo'?null:identities.get(row.id)?.identity_observed_at??null,speechBubble:{lines:publicLines,renderedLines:bubbleClock?.key===JSON.stringify(publicLines)?bubbleClock.renderedLines??publicLines:publicLines,placement:clone(station.speechPlacement??null),motion:clone(station.bubbleMotion??null)},actorVisible:station.presentation?.actorVisible??false,neutral:station.presentation?.neutral??true};
      })};
  }
  destroy(){
    if(this.destroyed)return;this.destroyed=true;this.previewVersion++;
    const r=this.runtime,scene=r.scene;r.ready=false;r.profileLifetime=(r.profileLifetime??0)+1;
    this.systemMotionQuery?.removeEventListener('change',this.systemMotionHandler);
    r.motionQuery?.removeEventListener('change',r.motionHandler);r.renderQuality?.destroy();
    scene?.events.off('postupdate',r.cameraAnnotationHandler);
    scene?.events.off('shutdown',this.shutdownHandler);
    const keys=[];
    for(const station of r.stations){station.player._directionRequest++;station.playerRequest=(station.playerRequest??0)+1;station.profileRequest=(station.profileRequest??0)+1;if(station.textureKey)keys.push(station.textureKey);}
    for(const bench of r.benches??[])if(bench.sprite)keys.push(bench.sprite.texture.key);
    for(const overlay of r.screenOverlays??[])for(const component of overlay.components)keys.push(component.texture.key);
    for(const object of this.sceneObjects??[])object.destroy();
    r.serverCabinetAnimation?.destroy();
    for(const key of keys)if(scene?.textures.exists(key))scene.textures.remove(key);
    if(globalThis.window && this.renderQualityGlobal && globalThis.window.officeRenderQuality===this.renderQualityGlobal)delete globalThis.window.officeRenderQuality;
    this.listeners.clear();r.adapter=null;
  }
}
  return OfficeRuntimeAdapter;
}
export const OfficeRuntimeAdapter = createOfficeRuntimeAdapter(ConnectedOfficeRuntime);
export async function loadOfficeRuntimeAdapter(path,options){return OfficeRuntimeAdapter.load(path,options);}

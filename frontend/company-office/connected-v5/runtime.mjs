import {ReferenceOfficeRuntime,validateReferenceLayout,overlaps,occupiedBounds} from '../reference-v3/runtime.mjs';
import {loadImage} from '../seated-compositor.mjs';
import {ConnectedSeatedPlayer} from './seated-player.mjs';
import {BenchScreenOverlay} from './screen-overlay.mjs';
import {RockRoomAnimation,validateRockRoomAnimation} from './rock-room-animation.mjs';
import {loadCharacterProfileAssets} from '../character-profile-assets.mjs';
import {DEFAULT_CHARACTER_PROFILE_ID,isRuntimeReadyCharacterProfile} from '../character-profile-runtime.mjs';
import {validateBenchManifest,normalizeBenchManifest,benchTransform,sourceToWorld,centerForContact,absoluteAssetPaths,SIDE_DIRECTION,ACTOR_BOUNDS} from './furniture-contract.mjs';
import {screenSafeBubbleLayout} from './bubble-layout.mjs';
export {STATE_LABELS} from '../reference-v3/runtime.mjs';
export {BUSINESS_STATES} from '../reference-v3/directional-player.mjs';
async function json(url){const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error(`connected-v5 resource ${response.status}: ${url}`);return response.json();}
function contained(a,b){return b[0]>=a[0]&&b[1]>=a[1]&&b[0]+b[2]<=a[0]+a[2]&&b[1]+b[3]<=a[1]+a[3];}
export function validateConnectedLayout(layout){
  validateReferenceLayout(layout);
  if(layout.id!=='company-office-connected-v5'||layout.furnitureMode!=='connected-benches'||layout.benches?.length!==2)throw new Error('connected-v5 requires exactly two continuous benches');
  const ids=new Set();
  for(const bench of layout.benches){
    if(!bench.id||ids.has(bench.id)||!['vertical','horizontal'].includes(bench.orientation)||bench.stationIds?.length!==8||!bench.manifest)throw new Error('Invalid bench specification');ids.add(bench.id);
    if(new Set(bench.stationIds).size!==8||bench.stationIds.some(id=>!layout.stations.some(s=>s.id===id&&s.benchId===bench.id)))throw new Error('Bench seat binding mismatch');
    if(bench.alphaWorld&&(!contained([0,0,...layout.size],bench.alphaWorld)||(layout.forbidden??[]).some(a=>overlaps(bench.alphaWorld,a.bounds))))throw new Error(`${bench.id}: bench occupies a room`);
  }
  if(new Set(layout.benches.flatMap(b=>b.stationIds)).size!==16)throw new Error('Bench seats must be unique');
  return layout;
}
/** Resolve source contacts before the inherited validator sees station geometry. */
export function attachBenchContacts(layout,assets,benchRecords){
  const result=structuredClone(layout);
  for(const record of benchRecords){
    const bench=result.benches.find(b=>b.id===record.spec.id),t=record.transform;
    bench.alphaWorld=t.alphaWorld;
    for(const contact of record.manifest.seatContacts){
      const station=result.stations.find(s=>s.id===contact.id),direction=SIDE_DIRECTION[contact.side];
      station.direction=direction;station.contact=sourceToWorld(t,contact.anchor);station.contactSource=[...contact.anchor];station.side=contact.side;
      if(contact.contactConversion==='torso-center'){
        // Side pack annotations describe torso, while the frozen actor poseAnchor
        // is feet/chair contact. Move the whole seat, never the actor parameters.
        station.contact[1]+=30*station.scale;
      }else if(contact.contactConversion==='desk-rim'){
        const edgeOffset=direction==='down'?8:direction==='up'?27:0;
        station.contact[1]+=edgeOffset*station.scale;
      }
      station.contactConversion=contact.contactConversion??'original-pose-anchor';
      station.center=centerForContact(station.contact,assets.directions[direction].furniture.seatAnchor,station.scale);
      station.occupied=[...ACTOR_BOUNDS[direction]];
    }
  }
  return validateConnectedLayout(result);
}
async function sourceHashes(assets){
  // Employee HTTP/LAN origins have no SubtleCrypto. Provenance is optional,
  // not an authentication gate: never fail the scene or claim uncomputed hashes.
  if(!globalThis.crypto?.subtle) return {algorithm:'SHA-256',status:'unavailable-in-insecure-context',sourceAssets:'/static/company-office/reference-v3/assets.json',files:[]};
  const urls=new Set();for(const spec of Object.values(assets.directions)){urls.add(spec.character.base);for(const action of Object.values(spec.character.actions))if(action.frames)urls.add(action.frames);}
  const entries=await Promise.all([...urls].map(async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`Cannot hash original sprite: ${r.status}`);const hash=await crypto.subtle.digest('SHA-256',await r.arrayBuffer());return {url,sha256:Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('')};}));
  return {algorithm:'SHA-256',sourceAssets:'/static/company-office/reference-v3/assets.json',files:entries};
}
export class ConnectedOfficeRuntime extends ReferenceOfficeRuntime {
  roomLabelFontSize(){
    return this.view==='overview'&&this.renderQuality?.measurement?.cssSize?.[0]<700?8:14;
  }
  static async load(path){
    const baseUrl=new URL(path,location.href).href;
    const [layout,configuration]=await Promise.all([json(new URL('layout.json',baseUrl)),json(new URL('assets.json',baseUrl))]);
    validateRockRoomAnimation(layout,configuration);
    const template=await json(new URL(configuration.characterTemplate??'./character-template.json',baseUrl));
    if(template.templateId!=='connected-v5-character-template-v1'||template.schemaVersion!==5||template.scene!==layout.id||template.furnitureMode!==layout.furnitureMode||template.freeze?.walking!==false||template.freeze?.keyboardInteraction!==false)throw new Error('V5 character template does not match the current scene');
    const sourceUrl=new URL(configuration.referenceAssets??'../reference-v3/assets.json',baseUrl),referenceAssets=await json(sourceUrl);
    const assets=absoluteAssetPaths(referenceAssets,new URL('.',sourceUrl));
    const records=await Promise.all(layout.benches.map(async spec=>{
      const manifestUrl=new URL(spec.manifest,baseUrl),manifest=validateBenchManifest(normalizeBenchManifest(await json(manifestUrl),spec),spec),imageUrl=new URL(manifest.image,manifestUrl).href,image=await loadImage(imageUrl);
      if((image.naturalWidth||image.width)!==manifest.actualPixelSize[0]||(image.naturalHeight||image.height)!==manifest.actualPixelSize[1])throw new Error(`${spec.id}: manifest pixel dimensions differ from decoded image`);
      return {spec,manifest,imageUrl,image,transform:benchTransform(manifest,spec.fit)};
    }));
    const runtime=new this(attachBenchContacts(layout,assets,records),assets,baseUrl);
    runtime.rockRoomAnimation=new RockRoomAnimation(layout,configuration,baseUrl);
    runtime.benches=records;runtime.characterTemplate=template;runtime.sourceSpriteHashes=await sourceHashes(assets);
    await Promise.all(runtime.stations.map(async station=>{
      station.player=await new ConnectedSeatedPlayer(document.createElement('canvas'),assets,{baseUrl,direction:station.direction,reducedMotion:runtime.reducedMotion}).initialize();
      runtime.attachPlayerToBench(station,station.player);station.player.setState('idle');
      station.renderedCharacterProfileId=DEFAULT_CHARACTER_PROFILE_ID;station.requestedCharacterProfileId=DEFAULT_CHARACTER_PROFILE_ID;
    }));
    runtime.player=runtime.getStation(layout.mainStation).player;return runtime;
  }
  attachPlayerToBench(station,player){
    const record=this.benches.find(b=>b.spec.id===station.benchId);
    player.setBenchContext({image:record.image,transform:record.transform,center:station.center,stationScale:station.scale});return player;
  }
  preload(scene){
    super.preload(scene);
    this.rockRoomAnimation?.preload(scene);
  }
  create(scene){
    this.screenOverlays=[];
    for(const b of this.benches){
      const key=`connected-v5-bench-${b.spec.id}`,t=b.transform;scene.textures.addImage(key,b.image);
      b.sprite=scene.add.image(t.x,t.y,key).setOrigin(0).setDisplaySize(t.width,t.height).setDepth(-10);b.sprite.setData('companyOfficeLocked',true);
      for(const screen of b.manifest.screens)this.screenOverlays.push(new BenchScreenOverlay(scene,screen,t,`${key}-${screen.seatId}`));
    }
    // Parent creates unchanged high-density text, camera, state bindings, LEDs,
    // clickable actors and demo controls; it receives chair-only player canvases.
    const background=super.create(scene);this.background=background;
    this.rockRoomAnimation?.create(scene);
    for(const station of this.stations){
      // Preserve the non-overlapping occupied-envelope hit area created by the
      // parent runtime; a full sprite canvas makes adjacent rows ambiguous.
      if(!station.sprite.input?.customHitArea)station.sprite.setInteractive({useHandCursor:true,pixelPerfect:true,alphaTolerance:4});
    }
    return background;
  }
  layoutClearBubbles(){
    if(this._connectedBubbleLayout)return;
    super.layoutClearBubbles();
    if(!this.renderQuality||!this.screenOverlays?.length)return;
    this._connectedBubbleLayout=true;
    try{
      const cam=this.scene.cameras.main,unit=this.renderQuality.density/cam.zoom;
      const viewport=[cam.scrollX+cam.width/2-cam.width/(2*cam.zoom),cam.scrollY+cam.height/2-cam.height/(2*cam.zoom),cam.width/cam.zoom,cam.height/cam.zoom];
      const protectedRects=[];
      for(const record of this.benches)for(const screen of record.manifest.screens){
        // Glass and rear monitor casing both need clear annotations. Source LEDs
        // receive a separate tiny guard even when no glass is visible.
        if(screen.polygon?.length){const points=screen.polygon.map(p=>sourceToWorld(record.transform,p)),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);protectedRects.push([Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)]);}
        if(screen.led){const [x,y,w=2,h=2]=screen.led,[wx,wy]=sourceToWorld(record.transform,[x,y]);protectedRects.push([wx,wy,w*record.transform.scale,h*record.transform.scale]);}
      }
      this.screenProtectionRects=protectedRects;
      const results=screenSafeBubbleLayout(this.stations,protectedRects,viewport,unit);
      const colors={idle:0x63818a,writing:0x49796d,researching:0x346887,executing:0x4e7350,syncing:0x8d6e3d,error:0xa65049};
      for(const station of this.stations){
        const result=results.get(station.id);station.bubbleScreenClear=result?.clear??true;station.bubbleScreenRelocated=result?.changed??false;station.bubbleLeader=result?.leader??[];
        if(!result?.changed)continue;
        const [x,y,w,h]=result.rect,cx=x+w/2,cy=y+h/2;
        station.bubbleRect=result.rect;station.bubbleAnchor=[cx,cy];station.bubbleRelocated=true;station.bubblePlacementClear=result.clear;
        station.bubbleText.setPosition(cx,cy);
        const g=station.bubbleBackground;g.clear();g.fillStyle(station.source==='unbound'?0x53615d:colors[station.state],0.96);g.fillRoundedRect(x,y,w,h,4*unit);
        g.lineStyle((station.id===this.activeStation?2:1)*unit,station.id===this.activeStation?0xe4c582:0xf1e6cf,0.9);g.strokeRoundedRect(x,y,w,h,4*unit);
        const line=result.leader??[];
        if(line.length){g.lineStyle(unit,0xe4d4b5,0.72);g.beginPath();g.moveTo(...line[0]);for(const p of line.slice(1))g.lineTo(...p);g.strokePath();}
      }
      const bubbles=this.stations.filter(s=>s.bubbleVisible).map(s=>s.bubbleRect),heads=this.stations.filter(s=>s.headAnchor).map(s=>[s.headAnchor[0]-30*s.scale,s.headAnchor[1]-2*s.scale,60*s.scale,56*s.scale]);
      this.layoutClearRoomLabels(unit,bubbles,heads);
    }finally{this._connectedBubbleLayout=false;}
  }
  setRoomCharacterVisibility(settings) {
    this.roomCharacterSettings = structuredClone(settings ?? {});
    this.rockRoomAnimation?.applyVisibility(this.roomCharacterSettings);
  }
  update(time){
    super.update(time);
    if(this.ready)for(const overlay of this.screenOverlays??[]){const station=this.getStation(overlay.screen.seatId);overlay.sample(station.state,Math.max(0,time-station.epoch),this.reducedMotion);}
    if(this.ready)this.rockRoomAnimation?.update(time);
  }
  async commitPlayer(station,player,direction,profileId=station.renderedCharacterProfileId){
    station.direction=direction;station.center=centerForContact(station.contact,player.spec.furniture.seatAnchor,station.scale);station.occupied=[...ACTOR_BOUNDS[direction]];
    this.attachPlayerToBench(station,player);player.setPresentation(station.presentation??{actorVisible:station.player?.actorVisible!==false,neutral:!!station.player?.neutral});player.setState(station.state);player.sample(Math.max(0,(this.scene?.time.now??0)-station.epoch));
    if(this.scene){
      const old=station.textureKey,key=`connected-v5-seat-${station.id}-${++station.version}`;
      station.texture=this.scene.textures.addCanvas(key,player.canvas);station.textureKey=key;
      station.sprite.setTexture(key).setPosition(station.center[0]-96*station.scale,station.center[1]-96*station.scale).setDepth(station.center[1]+80);this.scene.textures.remove(old);
    }
    station.player=player;station.renderedCharacterProfileId=profileId;station.characterLoadError=null;this.refreshAnchor(station);this.refreshBubble(station);this.refreshMain();this.drawSelection();this.emit();
  }
  checkPlacement(station,player,direction){
    const trial={...station,direction,center:centerForContact(station.contact,player.spec.furniture.seatAnchor,station.scale),occupied:ACTOR_BOUNDS[direction]},bounds=occupiedBounds(trial);
    if(!contained([0,0,...this.layout.size],bounds)||(this.layout.forbidden??[]).some(a=>overlaps(bounds,a.bounds))||this.stations.some(other=>other!==station&&overlaps(bounds,occupiedBounds(other))))throw new Error('Replacement would overlap another seat or room');
  }
  async setStationDirection(id,direction){
    if(!['up','down','left','right'].includes(direction))throw new Error('只支持上下左右四方向');
    const station=this.getStation(id),request=station.playerRequest=(station.playerRequest??0)+1;
    const player=await new ConnectedSeatedPlayer(document.createElement('canvas'),station.player.assets,{baseUrl:this.baseUrl,direction,reducedMotion:this.reducedMotion}).initialize();
    if(station.playerRequest!==request||this.adapter?.destroyed)return;
    player.setReducedMotion(this.reducedMotion);
    this.checkPlacement(station,player,direction);await this.commitPlayer(station,player,direction);
  }
  async replaceCharacter(character,{baseUrl=this.baseUrl,stationId=this.activeStation}={}){
    const station=this.getStation(stationId);if(character.direction!==station.direction)throw new Error('替换角色必须与当前工位方向一致');
    const request=station.playerRequest=(station.playerRequest??0)+1,assets=structuredClone(station.player.assets),c=structuredClone(character);
    c.base=new URL(c.base,baseUrl).href;for(const action of Object.values(c.actions))if(action.frames)action.frames=new URL(action.frames,baseUrl).href;
    assets.directions[station.direction].character=c;
    const player=await new ConnectedSeatedPlayer(document.createElement('canvas'),assets,{baseUrl:this.baseUrl,direction:station.direction,reducedMotion:this.reducedMotion}).initialize();
    if(station.playerRequest!==request||this.adapter?.destroyed)return;
    player.setReducedMotion(this.reducedMotion);
    this.checkPlacement(station,player,station.direction);await this.commitPlayer(station,player,station.direction);this.characterVersion++;this.emit();
  }
  /** Preload all directions, keeping the current player on failure or stale requests. */
  async setStationCharacterProfile(stationId,profileId){
    if(!isRuntimeReadyCharacterProfile(profileId))throw new Error('角色动画尚未就绪');
    const station=this.getStation(stationId);
    station.requestedCharacterProfileId=profileId;
    const lifetime=this.profileLifetime??0;
    if(station.characterProfilePending?.id===profileId)return station.characterProfilePending.promise;
    const request=station.profileRequest=(station.profileRequest??0)+1;
    if(station.renderedCharacterProfileId===profileId){station.characterProfilePending=null;station.characterLoadError=null;return true;}
    const pending={id:profileId,promise:null};
    const prepare=async()=>{
      try{
        const assets=await this.characterAssetsForProfile(profileId);
        const players=await Promise.all(['up','down','left','right'].map(direction=>this.prepareCharacterPlayer(assets,direction)));
        if(station.profileRequest!==request||(this.profileLifetime??0)!==lifetime||this.adapter?.destroyed)return false;
        const player=players.find(p=>p.direction===station.direction);
        player.setReducedMotion(this.reducedMotion);
        const direction=player.direction;
        station.player._directionRequest=(station.player._directionRequest??0)+1;
        this.checkPlacement(station,player,direction);
        // Cancel a pending direction using the old breed; commit metadata with pixels.
        station.playerRequest=(station.playerRequest??0)+1;
        await this.commitPlayer(station,player,direction,profileId);
        this.characterVersion++;return true;
      }catch(error){if(station.profileRequest===request)station.characterLoadError='角色动画加载失败';throw error;}
      finally{if(station.characterProfilePending===pending)station.characterProfilePending=null;}
    };
    station.characterProfilePending=pending;pending.promise=prepare();return pending.promise;
  }
  prepareCharacterPlayer(assets,direction){return new ConnectedSeatedPlayer(document.createElement('canvas'),assets,{baseUrl:this.baseUrl,direction,reducedMotion:this.reducedMotion}).initialize();}
  characterAssetsForProfile(profileId){return loadCharacterProfileAssets(profileId,this.assets);}
  /** Replace one mask/LED atomically; never light keyboard or rear screen content. */
  replaceScreen(stationId,screen){
    if(!this.ready)throw new Error('Scene must be ready to replace a screen');
    const station=this.getStation(stationId),record=this.benches.find(b=>b.spec.id===station.benchId);
    const manifest=structuredClone(record.manifest),index=manifest.screens.findIndex(s=>s.seatId===stationId);
    manifest.screens[index]={...structuredClone(screen),seatId:stationId};validateBenchManifest(manifest,record.spec);
    const version=(this.screenVersion??0)+1;
    const replacement=new BenchScreenOverlay(this.scene,manifest.screens[index],record.transform,`connected-v5-screen-${stationId}-${version}`);
    replacement.sample(station.state,Math.max(0,this.scene.time.now-station.epoch),this.reducedMotion);
    const old=this.screenOverlays.find(s=>s.screen.seatId===stationId);
    this.screenOverlays[this.screenOverlays.indexOf(old)]=replacement;record.manifest=manifest;this.screenVersion=version;
    for(const component of old.components){component.sprite.destroy();this.scene.textures.remove(component.texture.key);}
    this.layoutClearBubbles();this.emit();
  }
  snapshot(){const original=super.snapshot();return {...original,characterTemplateId:this.characterTemplate?.templateId??null,animationMode:'full-frame-plus-screen-effects',screenAnimationContract:{"mode":"screen-only","activeStates":["writing","researching","executing","syncing","error"],"staticStates":["idle"],"fps":12,"content":"code-editor-search-terminal","rearScreens":"led-only","keyboardInteraction":false},stations:original.stations.map(s=>({...s,renderedCharacterProfileId:this.getStation(s.id).renderedCharacterProfileId??DEFAULT_CHARACTER_PROFILE_ID,characterLoadError:this.getStation(s.id).characterLoadError??null,bubbleScreenClear:this.getStation(s.id).bubbleScreenClear??true,bubbleScreenRelocated:this.getStation(s.id).bubbleScreenRelocated??false,bubbleLeader:this.getStation(s.id).bubbleLeader??[]})),screenProtectionRects:this.screenProtectionRects??[],scene:'company-office-connected-v5',furnitureMode:'connected-benches',benchCount:2,benches:this.benches.map(b=>({id:b.spec.id,orientation:b.spec.orientation,seatCount:8,stationIds:b.spec.stationIds,image:b.imageUrl,actualPixelSize:b.manifest.actualPixelSize,alphaBounds:b.manifest.alphaBounds,alphaWorld:b.transform.alphaWorld})),screens:(this.screenOverlays??[]).map(s=>s.snapshot()),rockRoomAnimation:this.rockRoomAnimation?.snapshot()??{enabled:false,room:'rock',frame:0,frameCount:12,fps:12,performerCount:0,performerIds:[],occlusionLayerCount:0,occlusionLayerIds:[],reducedMotion:this.reducedMotion,audio:false,walking:false,bounds:[708,701,480,206]}};}
}
// Optional drop-in import for existing route code. No reference-v3 source changes.
export {ConnectedOfficeRuntime as ReferenceOfficeRuntime};

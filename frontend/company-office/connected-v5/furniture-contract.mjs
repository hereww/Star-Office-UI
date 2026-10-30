import {validateScreenConfig} from '../reference-v3/screen-effects.mjs';
/** Source-pixel furniture contract. No placeholder desks or orientation transforms. */
const sides = {vertical:['left','right'],horizontal:['top','bottom']};
export const SIDE_DIRECTION = Object.freeze({left:'right',right:'left',top:'down',bottom:'up'});
export const CHAIR_CLIPS = Object.freeze({
  right:{back:[26,75,72,99],front:[26,112,65,62]},
  left:{back:[103,77,63,97],front:[103,112,63,62]},
  down:{back:[67,31,61,60],front:null},
  up:{back:null,front:[66,110,63,66]},
});
export const ACTOR_BOUNDS = Object.freeze({right:[8,30,90,139],left:[86,41,83,121],down:[38,1,115,103],up:[47,63,88,106]});

/**
 * Per-direction bench-desktop occlusion insets used by ConnectedSeatedPlayer
 * to clip lower-body pixels that fall behind the shared bench desktop alpha.
 *
 * All values are measured in the 192×192 character-canvas coordinate space and
 * were derived from the connected-v4 bench pixel geometry (manifests under
 * connected-v4/media/).  Re-measure from the bench image whenever seatAnchor
 * or the desktop sprite is replaced.
 *
 * Each entry is [sideInset, topInset]:
 *   sideInset – horizontal distance from the character-facing edge of the
 *               canvas to the desktop rim (left: from left edge of canvas to
 *               desktop right rim; right: from desktop left rim to right edge).
 *   topInset  – how many px above seatAnchor[1] the desktop top surface sits;
 *               the clip rect starts at (seatAnchor[1] − topInset).
 *
 * Sources (character-template.json baselineGeometry):
 *   down  seatAnchor [97, 94]   → desktop rim ≈ 8 px above seat contact
 *   left  seatAnchor [131,128]  → desktop rim ≈ 18 px above seat contact;
 *                                  horizontal rim at x = seatAnchor[0] − 9
 *   right seatAnchor [62, 130]  → same 18 px rule; rim at x = seatAnchor[0] + 9
 */
export const BENCH_OCCLUSION_INSETS = Object.freeze({
  down:  { topInset: 8,  sideInset: 0 },
  left:  { topInset: 18, sideInset: 9 },
  right: { topInset: 18, sideInset: 9 },
});
const pair = p => Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
const rect = p => Array.isArray(p)&&p.length===4&&p.every(Number.isFinite)&&p[2]>0&&p[3]>0;
const within = (p,size) => pair(p)&&p[0]>=0&&p[1]>=0&&p[0]<=size[0]&&p[1]<=size[1];
/** Adapter for the two independently authored furniture manifests; source files stay read-only. */
export function normalizeBenchManifest(source,bench){
  const m=structuredClone(source);
  const ltrb=typeof m.alphaBoundsConvention==='string'&&/rightExclusive/.test(m.alphaBoundsConvention);
  if(ltrb){
    const raw=[...m.alphaBounds],bounds=m.visibleAlphaBounds??raw;
    m.alphaBounds=[bounds[0],bounds[1],bounds[2]-bounds[0],bounds[3]-bounds[1]];
    m.normalization={sourceAlphaBounds:raw,sourceVisibleAlphaBounds:m.visibleAlphaBounds??null,sourceConvention:m.alphaBoundsConvention,fitPolicy:'visible-alpha uniform contain'};
  }
  m.seatContacts=m.seatContacts.map(contact=>{
    const side=contact.side??(contact.row==='north'?'top':contact.row==='south'?'bottom':null);
    const direction=contact.direction??contact.characterDirection??SIDE_DIRECTION[side];
    const c={...contact,id:contact.id??contact.seatId??contact.deskId,side,direction};
    if(contact.anchor)c.anchor=[...contact.anchor];
    else if(contact.point){c.anchor=[...contact.point];c.contactConversion='torso-center';}
    else if(contact.position){c.anchor=[...contact.position];c.contactConversion='desk-rim';}
    return c;
  });
  m.screens=m.screens.map(screen=>{
    const s={...screen,seatId:screen.seatId??screen.id,kind:screen.kind??(screen.visible===false?'back':'front')};
    if(screen.led&&typeof screen.led==='object'&&!Array.isArray(screen.led)){
      const led=screen.led;
      // Front proposal points are not source LEDs: do not invent hardware.
      if(led.sourceVisible===false)delete s.led;
      else {const [x,y]=led.position,r=led.radius??1;s.led=[x-r,y-r,2*r,2*r];}
    }
    return s;
  });
  // Keyboard annotations remain source provenance only. Screen-only playback
  // does not require or synthesize character-to-keyboard interaction geometry.
  return m;
}
export function validateBenchManifest(manifest,bench){
  const m=structuredClone(manifest),size=m.actualPixelSize;
  if(typeof m.image!=='string'||!m.image.trim()||!pair(size)||size.some(n=>!Number.isInteger(n)||n<1||n>8192))throw new Error(`${bench.id}: image/actualPixelSize invalid`);
  if(!rect(m.alphaBounds)||m.alphaBounds[0]<0||m.alphaBounds[1]<0||m.alphaBounds[0]+m.alphaBounds[2]>size[0]||m.alphaBounds[1]+m.alphaBounds[3]>size[1])throw new Error(`${bench.id}: alphaBounds invalid`);
  if(!sides[bench.orientation]||!Array.isArray(m.seatContacts)||m.seatContacts.length!==8)throw new Error(`${bench.id}: exactly eight contact anchors required`);
  const ids=new Set();
  // Contact anchors may be extrapolated outside the image if a tight-alpha
  // furniture export has no chair margins. Logical-map validation is authoritative.
  for(const contact of m.seatContacts){
    if(!bench.stationIds.includes(contact.id)||ids.has(contact.id)||!sides[bench.orientation].includes(contact.side)||!pair(contact.anchor))throw new Error(`${bench.id}: contact id/side/anchor invalid`);
    ids.add(contact.id);
    if(contact.direction&&contact.direction!==SIDE_DIRECTION[contact.side])throw new Error(`${contact.id}: contact must face into bench`);
  }
  for(const side of sides[bench.orientation])if(m.seatContacts.filter(s=>s.side===side).length!==4)throw new Error(`${bench.id}: each side requires four seats`);
  if(!Array.isArray(m.screens)||m.screens.length!==8)throw new Error(`${bench.id}: one screen per seat required`);
  const screenIds=new Set();
  for(const s of m.screens){
    if(!ids.has(s.seatId)||screenIds.has(s.seatId)||!['front','back'].includes(s.kind))throw new Error(`${bench.id}: screen seat/kind invalid`);
    screenIds.add(s.seatId);
    if(s.kind==='front'&&(!Array.isArray(s.polygon)||s.polygon.length<3||!s.polygon.every(p=>within(p,size))))throw new Error(`${s.seatId}: visible screen polygon required`);
    if(s.led!==undefined&&!(pair(s.led)&&within(s.led,size))&&!(rect(s.led)&&within(s.led.slice(0,2),size)&&within([s.led[0]+s.led[2],s.led[1]+s.led[3]],size)))throw new Error(`${s.seatId}: LED invalid`);
    if(s.kind==='back'&&!s.led)throw new Error(`${s.seatId}: rear monitor requires an LED, never content`);
    if(s.kind==='front'){
      const xs=s.polygon.map(p=>p[0]),ys=s.polygon.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;
      if(w<=0||h<=0)throw new Error(`${s.seatId}: degenerate screen`);
      validateScreenConfig({visible:true,polygon:s.polygon.map(([px,py])=>[(px-x)*192/w,(py-y)*192/h])});
    }
  }
  return m;
}
/** Uniform contain of the alpha bounds, with transparent source margins retained. */
export function benchTransform(manifest,fit){
  if(!rect(fit))throw new Error('Bench fit invalid');
  const [ax,ay,aw,ah]=manifest.alphaBounds,scale=Math.min(fit[2]/aw,fit[3]/ah);
  const x=fit[0]+(fit[2]-aw*scale)/2-ax*scale,y=fit[1]+(fit[3]-ah*scale)/2-ay*scale;
  return {x,y,scale,width:manifest.actualPixelSize[0]*scale,height:manifest.actualPixelSize[1]*scale,alphaWorld:[x+ax*scale,y+ay*scale,aw*scale,ah*scale]};
}
export function sourceToWorld(transform,point){return [transform.x+point[0]*transform.scale,transform.y+point[1]*transform.scale];}
export function centerForContact(contact,seatAnchor,scale){return [contact[0]-(seatAnchor[0]-96)*scale,contact[1]-(seatAnchor[1]-96)*scale];}
export function absoluteAssetPaths(assets,baseUrl){
  const resolved=structuredClone(assets);
  const character=c=>{c.base=new URL(c.base,baseUrl).href;for(const a of Object.values(c.actions))if(a.frames)a.frames=new URL(a.frames,baseUrl).href;};
  if(resolved.character)character(resolved.character);
  for(const spec of Object.values(resolved.directions)){
    character(spec.character);for(const layer of ['back','front'])spec.furniture[layer]=new URL(spec.furniture[layer],baseUrl).href;
  }
  return resolved;
}

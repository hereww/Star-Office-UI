// BUILD-TIME ONLY. Complete-frame restoration from archived base pixels.
// The adjacent legacy module preserves the historical expressions/provenance.
// This derived renderer retains that blink/spiral/sleep timing, while using
// measured original features instead of drawing a second, misregistered face.
const ACTIONS = ['working', 'idle', 'syncing', 'error'];
const BLINK = [1, 1, .93, .78, .5, .22, 0, .22, .5, .78, .93, 1];
const SIZE = 192;
const clamp = n => Math.max(0, Math.min(255, Math.round(n)));
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const inBox = (x, y, [l,t,r,b]) => x >= l && x < r && y >= t && y < b;

function colourAt(data, x, y) {
  const i = (Math.round(y) * SIZE + Math.round(x)) * 4;
  return [data[i], data[i+1], data[i+2]];
}
function put(data, x, y, colour, repair) {
  x=Math.round(x); y=Math.round(y);
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || inBox(x,y,repair.noseBounds)) return;
  const i=(y*SIZE+x)*4;
  data[i]=clamp(colour[0]);data[i+1]=clamp(colour[1]);data[i+2]=clamp(colour[2]);
}
function field(data, points, x, y) {
  // Inverse-distance blend of measured, eye-free fur samples. No source pupil
  // is copied into a closed socket, and no uniform oval replaces face texture.
  const weights=points.map(([sx,sy])=>1/(4+(sx-x)**2+(sy-y)**2));
  const total=weights.reduce((a,b)=>a+b,0);
  return [0,1,2].map(c=>points.reduce((sum,[sx,sy],i)=>sum+colourAt(data,sx,sy)[c]*weights[i],0)/total);
}
function eyeMask(base, bounds, samples, coreBounds=bounds,template,templateCenter,repair,templateShift=0,sourceBounds) {
  const [l,t,r,b]=bounds,cx=(l+r-1)/2,cy=(t+b-1)/2,rx=(r-l)/2,ry=(b-t)/2;
  const pixels=[];
  for(let y=t;y<b;y++)for(let x=l;x<r;x++) {
    const original=colourAt(base,x,y);
    // Extend the original fur directly above this column into the socket.
    // Median of three source rows avoids copying a lone brow/outline pixel;
    // it retains actual pixel colours instead of a smooth four-point gradient.
    const topColours=[coreBounds[1]-4,coreBounds[1]-3,coreBounds[1]-2].map(sy=>colourAt(base,x,sy))
      .sort((a,b)=>a.reduce((s,v)=>s+v,0)-b.reduce((s,v)=>s+v,0));
    let fur=topColours[1];
    // A source column can touch a light blaze. The explicitly measured
    // same-fur samples bound its luminance; don't spread a white nose bridge.
    const safe=samples.map(([sx,sy])=>colourAt(base,sx,sy));
    const sorted=safe.map(c=>c.reduce((s,v)=>s+v,0)).sort((a,b)=>a-b);
    if(fur.reduce((s,v)=>s+v,0)>sorted[2]*1.4)fur=safe[0];
    // Continue the nearest matching fur on this scanline toward the lower
    // lid. Choosing by colour avoids crossing a white blaze, while following
    // actual side pixels avoids the vertical bands of a stretched top row.
    const sides=[[l-2,y],[r+1,y]].filter(([sx,sy])=>!inBox(sx,sy,repair.noseBounds)).map(([sx,sy])=>colourAt(base,sx,sy));
    if(!sides.length)sides.push(fur);
    sides.sort((a,b)=>a.reduce((s,v,i)=>s+(v-fur[i])**2,0)-b.reduce((s,v,i)=>s+(v-fur[i])**2,0));
    const blend=.8*(y-t)/Math.max(1,b-t-1);
    fur=fur.map((v,i)=>v*(1-blend)+sides[0][i]*blend);
    if(template){
      const tcx=(coreBounds[0]+coreBounds[2]-1)/2,tcy=(coreBounds[1]+coreBounds[3]-1)/2;
      // The archived generated face may place its nose/mouth below this eye.
      // Only use its eye/eyelid texture; extend the last clean cheek scanline
      // instead of importing a second facial feature into the lower socket.
      let sourceY=y+templateCenter[1]-tcy-(Math.abs(y-tcy)<=4?templateShift:0);
      let sourceX=x+templateCenter[0]-tcx;
      if(sourceBounds){sourceX=Math.max(sourceBounds[0],Math.min(sourceBounds[2]-1,sourceX));sourceY=Math.max(sourceBounds[1],Math.min(sourceBounds[3]-1,sourceY));}
      const eyeTexture=colourAt(template,sourceX,sourceY);
      const lowerMix=Math.max(0,Math.min(1,(tcy+7-y)/4));
      const cheek=field(base,samples,x,y);
      const restored=eyeTexture.map((v,i)=>v*lowerMix+cheek[i]*(1-lowerMix));
      const mix=inBox(x,y,coreBounds)?1:Math.min(1,Math.min(x-l,r-1-x,y-t,b-1-y)/2);
      fur=restored.map((v,i)=>v*mix+original[i]*(1-mix));
    }
    const norm=Math.abs((x-cx)/rx)**2.3+Math.abs((y-cy)/ry)**2.3;
    const dark=Math.max(...original)<72;
    const white=original.every(v=>v>240);
    // Rounded feature mask plus measured dark/white/iris edge pixels. All of
    // it is confined to the independently reviewed eye bounds, below brows.
    if(norm<=1 || dark || white) pixels.push([x,y,fur]);
  }
  const [cl,ct,cr,cb]=coreBounds;
  return {pixels,cx:(cl+cr-1)/2,cy:(ct+cb-1)/2,rx:(cr-cl)/2,ry:(cb-ct)/2,bounds:coreBounds,template:Boolean(template)};
}
function closedLid(out, eye, repair, frame, sleep) {
  const breath=sleep ? Math.round(Math.sin(frame*Math.PI/6)) : 0;
  const half=Math.max(5,Math.floor(eye.rx*.76));
  for(let dx=-half;dx<=half;dx++) {
    const lift=sleep?2.5:1.2;
    const y=eye.cy+1+breath-lift*(1-(dx/half)**2);
    // Some pale-fur profiles are displayed at 0.5 scale: an explicit two-row
    // stroke survives nearest-neighbour downsampling without dotted lids.
    for(let row=0;row<(repair.eyelidStroke??1);row++)put(out,eye.cx+dx,y+row,rgb(repair.sleepLine),repair);
  }
}
function drawEye(out, base, eye, repair, action, frame, iris) {
  if(action==='error') {
    // Keep the original eye outline and whites; only its actual iris becomes
    // the historical spinning spiral, at the measured source-eye centre.
    const radius=Math.min(eye.rx*.62,eye.ry*.66),phase=frame*Math.PI/6;
    for(let dy=-Math.ceil(radius);dy<=Math.ceil(radius);dy++)for(let dx=-Math.ceil(radius);dx<=Math.ceil(radius);dx++) {
      const dist=Math.hypot(dx,dy); if(dist>radius)continue;
      const angle=Math.atan2(dy,dx)+phase;
      put(out,eye.cx+dx,eye.cy+dy,Math.sin(dist*1.1-angle*2)>.1?rgb('#1d1a23'):rgb(iris),repair);
    }
    return;
  }
  const open=action==='idle'?0:BLINK[frame];
  const gaze=action==='syncing'?Math.round(Math.sin(frame*Math.PI/6)):0;
  if(open===1 && gaze===0)return; // Preserve the exact authentic open eye.
  for(const [x,y,fur] of eye.pixels)put(out,x,y,fur,repair);
  if(open===0){if(!eye.template)closedLid(out,eye,repair,frame,action==='idle');return;}
  const [l,t,r,b]=eye.bounds;
  for(const [x,y] of eye.pixels) {
    const top=eye.cy-(eye.cy-t)*open;
    const bottom=eye.cy+(b-1-eye.cy)*open;
    if(y<top || y>bottom)continue;
    const sx=x-gaze;
    if(sx>=l&&sx<r)put(out,x,y,colourAt(base,sx,y),repair);
  }
}
function sleepingMouth(out, base, repair, direction, frame, muzzle) {
  const [l,t,r,b]=repair.mouthBounds,cx=(l+r-1)/2;
  // The old smile's entire measured span is cleared; source nose stays put.
  // Use nearby muzzle samples when provided, otherwise the archived palette.
  const mouthColour=repair.mouthSamples?field(base,repair.mouthSamples,cx,t+2):rgb(muzzle);
  for(let y=t;y<b;y++)for(let x=l;x<r;x++) {
    const original=colourAt(base,x,y);
    // Clear the measured old dark smile only. Preserve untouched muzzle fur
    // rather than painting the whole mouth bounding region as a flat oval.
    if(original.reduce((a,v)=>a+v,0)<mouthColour.reduce((a,v)=>a+v,0)*.55) {
      let replacement=mouthColour;
      search:for(let distance=1;distance<=8;distance++)for(const [sx,sy] of [[x,y+distance],[x-distance,y],[x+distance,y],[x,y-distance]]) {
        if(sx<0||sy<0||sx>=SIZE||sy>=SIZE||inBox(sx,sy,repair.noseBounds))continue;
        const candidate=colourAt(base,sx,sy);
        if(candidate.reduce((a,v)=>a+v,0)>mouthColour.reduce((a,v)=>a+v,0)*.75){replacement=candidate;break search;}
      }
      put(out,x,y,replacement,repair);
    }
  }
  const side=direction!=='down';
  const mx=Math.round(cx+(direction==='left'?1:direction==='right'?-1:0));
  const top=t+2,breath=Math.round((1+Math.sin(frame*Math.PI/6))/2);
  const rows=side?[1,2,3,3,3,2,1]:[1,2,3,4,4,4,3,2,1];
  for(let dy=0;dy<rows.length;dy++)for(let dx=-rows[dy];dx<=rows[dy];dx++) {
    if(inBox(mx+dx,top+dy,repair.mouthBounds))put(out,mx+dx,top+dy,rgb('#2b1718'),repair);
  }
  const tongueTop=top+(side?3:5)+breath;
  for(let dy=0;dy<2;dy++)for(let dx=-2;dx<=2;dx++) {
    if(inBox(mx+dx,tongueTop+dy,repair.mouthBounds))put(out,mx+dx,tongueTop+dy,rgb('#ef7b82'),repair);
  }
}

export function createPixelFaceAtlases(base,c,{createCanvas}={}) {
  if(!createCanvas||!c.repair)throw new Error('Offline restoration requires measured feature geometry');
  const cell=createCanvas();cell.width=SIZE;cell.height=SIZE;
  const ctx=cell.getContext('2d');ctx.drawImage(base,0,0);
  const source=ctx.getImageData(0,0,SIZE,SIZE),raw=new Uint8ClampedArray(source.data);
  const eyes=c.repair.eyeBounds.map((bounds,i)=>eyeMask(raw,bounds,c.repair.furSamples[i],c.repair.eyeFeatureBounds?.[i],c.closedEyeSource,c.repair.closedEyeSource?.centers[i],c.repair,0,c.repair.closedEyeSource?.sampleBounds?.[i]));
  const sleepEyes=c.closedEyeSource?[-1,0,1].map(shift=>c.repair.eyeBounds.map((bounds,i)=>eyeMask(raw,bounds,c.repair.furSamples[i],c.repair.eyeFeatureBounds?.[i],c.closedEyeSource,c.repair.closedEyeSource.centers[i],c.repair,shift,c.repair.closedEyeSource.sampleBounds?.[i]))):null;
  const result={};
  for(const action of ACTIONS) {
    const sheet=createCanvas();sheet.width=SIZE*4;sheet.height=SIZE*3;const out=sheet.getContext('2d');
    for(let frame=0;frame<12;frame++) {
      const image=ctx.createImageData(SIZE,SIZE);image.data.set(raw);
      const activeEyes=action==='idle'&&sleepEyes?sleepEyes[1+Math.round(Math.sin(frame*Math.PI/6))]:eyes;
      for(const eye of activeEyes)drawEye(image.data,raw,eye,c.repair,action,frame,c.pixelFaceAnimation.iris);
      if(action==='idle')sleepingMouth(image.data,raw,c.repair,c.direction,frame,c.pixelFaceAnimation.muzzle);
      // Explicit snapshots prevent native Canvas retaining a mutable frame.
      out.putImageData(image,(frame%4)*SIZE,Math.floor(frame/4)*SIZE);
    }
    result[action]=sheet;
  }
  return result;
}

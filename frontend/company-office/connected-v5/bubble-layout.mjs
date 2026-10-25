/** Screen-space bubble collision/leader geometry; no character or texture changes. */
const overlap=(a,b)=>a[0]<b[0]+b[2]&&a[0]+a[2]>b[0]&&a[1]<b[1]+b[3]&&a[1]+a[3]>b[1];
const pad=(r,p)=>[r[0]-p,r[1]-p,r[2]+2*p,r[3]+2*p];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function segmentHits(a,b,rect){
  // All generated leader candidates are axis-aligned, with a tiny pixel-safe width.
  if(a[0]===b[0])return a[0]>=rect[0]&&a[0]<=rect[0]+rect[2]&&Math.min(a[1],b[1])<rect[1]+rect[3]&&Math.max(a[1],b[1])>rect[1];
  if(a[1]===b[1])return a[1]>=rect[1]&&a[1]<=rect[1]+rect[3]&&Math.min(a[0],b[0])<rect[0]+rect[2]&&Math.max(a[0],b[0])>rect[0];
  return true;
}
function leaderFor(rect,head,obstacles,unit,scale){
  const end=[head[0],head[1]-Math.max(2*unit,2*scale+unit)],start=[clamp(end[0],rect[0]+3*unit,rect[0]+rect[2]-3*unit),rect[1]+rect[3]];
  const candidateXs=[end[0],rect[0]-3*unit,rect[0]+rect[2]+3*unit,...obstacles.flatMap(r=>[r[0]-2*unit,r[0]+r[2]+2*unit])];
  const startYs=[start[1],rect[1]-3*unit];
  let best=null,cost=Infinity;
  for(const y of startYs)for(const x of candidateXs){
    const origin=y===start[1]?start:[start[0],rect[1]],points=[origin,[x,y],[x,end[1]],end];
    // The upward exit adds a tiny first vertical segment rather than crossing a bubble.
    if(y!==start[1])points.splice(1,0,[origin[0],y]);
    if(points.slice(1).some((p,i)=>obstacles.some(r=>segmentHits(points[i],p,r))))continue;
    const length=points.slice(1).reduce((n,p,i)=>n+Math.abs(p[0]-points[i][0])+Math.abs(p[1]-points[i][1]),0);
    if(length<cost){cost=length;best=points;}
  }
  return best??[]; // Never draw a line through a protected screen as a fallback.
}
export function screenSafeBubbleLayout(stations,protectedRects,viewport,unit){
  const visible=stations.filter(s=>s.bubbleVisible&&s.bubbleRect&&s.headAnchor),heads=visible.map(s=>({id:s.id,rect:[s.headAnchor[0]-30*s.scale,s.headAnchor[1]-2*s.scale,60*s.scale,56*s.scale]}));
  const screens=protectedRects.map(r=>pad(r,2*unit));
  const viewportContains=r=>r[0]>=viewport[0]+3*unit&&r[1]>=viewport[1]+3*unit&&r[0]+r[2]<=viewport[0]+viewport[2]-3*unit&&r[1]+r[3]<=viewport[1]+viewport[3]-3*unit;
  const blocked=(rect,others)=>screens.some(r=>overlap(rect,r))||heads.some(h=>overlap(rect,pad(h.rect,unit)))||others.some(r=>overlap(rect,pad(r,2*unit)));
  const problems=visible.filter(s=>screens.some(r=>overlap(pad(s.bubbleRect,2*unit),r)));
  const safe=visible.filter(s=>!problems.includes(s)),placed=safe.map(s=>s.bubbleRect),results=new Map();
  for(const s of safe)results.set(s.id,{rect:s.bubbleRect,changed:false,clear:!blocked(s.bubbleRect,placed.filter(r=>r!==s.bubbleRect))});
  for(const s of problems.sort((a,b)=>a.headAnchor[1]-b.headAnchor[1]||a.headAnchor[0]-b.headAnchor[0])){
    const [hx,hy]=s.headAnchor,[,,w,h]=s.bubbleRect,preferred=[hx-w/2,hy-h-7*unit,w,h],candidates=[];
    // Screen edges/column gaps supply diagonal positions before broad vertical rails.
    const xs=[preferred[0],...screens.flatMap(r=>[r[0]-w-3*unit,r[0]+r[2]+3*unit])];
    const ys=[preferred[1],...screens.map(r=>r[1]-h-3*unit),...heads.map(item=>item.rect[1]+item.rect[3]+2*unit)];
    for(const y of ys)for(const x of xs)candidates.push([x,y,w,h]);
    for(let row=0;row<14;row++)for(const dx of [0,w+5*unit,-w-5*unit,2*(w+5*unit),-2*(w+5*unit)])candidates.push([preferred[0]+dx,preferred[1]-row*(h+4*unit),w,h]);
    const score=r=>Math.abs(r[0]-preferred[0])+1.2*Math.abs(r[1]-preferred[1]);
    candidates.sort((a,b)=>score(a)-score(b));
    let best=candidates.find(r=>r[1]+h<=hy-3*unit&&viewportContains(r)&&!blocked(pad(r,unit),placed));
    if(!best){
      // Phones need screen-sized rails, not tiny world-space bubbles. Search an
      // overhead band first; retain a clear side callout only for a clipped head.
      outer:for(let y=Math.min(preferred[1],viewport[1]+viewport[3]-h-3*unit);y>=viewport[1]+3*unit;y-=3*unit){
        const candidatesX=[];for(let x=viewport[0]+3*unit;x+w<=viewport[0]+viewport[2]-3*unit;x+=3*unit)candidatesX.push(x);
        candidatesX.sort((a,b)=>Math.abs(a-preferred[0])-Math.abs(b-preferred[0]));
        for(const x of candidatesX){const r=[x,y,w,h];if(!blocked(pad(r,unit),placed)){best=r;break outer;}}
      }
    }
    // Explicitly report an impossible packed viewport, never hide a status label.
    best??=s.bubbleRect;
    const clear=!blocked(best,placed);placed.push(best);
    results.set(s.id,{rect:best,changed:true,clear});
  }
  const allRects=[...results.values()].map(v=>v.rect);
  for(const s of visible){
    const result=results.get(s.id),obstacles=[...screens,...heads.filter(h=>h.id!==s.id).map(h=>h.rect),...allRects.filter(r=>r!==result.rect).map(r=>pad(r,unit))];
    if(result.changed)result.leader=leaderFor(result.rect,s.headAnchor,obstacles,unit,s.scale);
  }
  return results;
}

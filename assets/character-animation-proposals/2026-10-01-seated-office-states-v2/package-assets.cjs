/** Automated local-patch extraction, no repainting or hand-edited frame registration. */
const sharp=require('sharp'),fs=require('node:fs/promises'),path=require('node:path');
const root=__dirname;
async function localPatch(buffer){
  const {data,info}=await sharp(buffer).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const xs=new Uint32Array(info.width),ys=new Uint32Array(info.height);
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>200){xs[x]++;ys[y]++;}
  // Dense scan bands ignore tiny isolated edge speckles while preserving artwork pixels.
  const xthreshold=Math.max(4,Math.max(...xs)*.12),ythreshold=Math.max(4,Math.max(...ys)*.12);
  let x0=xs.findIndex(v=>v>=xthreshold),y0=ys.findIndex(v=>v>=ythreshold);
  let x1=xs.findLastIndex(v=>v>=xthreshold),y1=ys.findLastIndex(v=>v>=ythreshold);
  if(x0<0||y0<0)throw new Error('No visible local patch');
  return {buffer:await sharp(buffer).extract({left:x0,top:y0,width:x1-x0+1,height:y1-y0+1}).png().toBuffer(),rect:[x0,y0,x1-x0+1,y1-y0+1]};
}
async function cells(filename){
  const file=path.join(root,'source',filename); await fs.access(file); const meta=await sharp(file).metadata();
  const out=[];
  for(let i=0;i<12;i++){
    const col=i%4,row=Math.floor(i/4);
    const left=Math.floor(col*meta.width/4),right=Math.floor((col+1)*meta.width/4);
    const top=Math.floor(row*meta.height/3),bottom=Math.floor((row+1)*meta.height/3);
    out.push(await sharp(file).extract({left,top,width:right-left,height:bottom-top}).png().toBuffer());
  }
  return out;
}
async function atlas(parts,w,h,name){
  await sharp({create:{width:w*4,height:h*3,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
    .composite(parts.map((buffer,i)=>({input:buffer,left:i%4*w,top:Math.floor(i/4)*h}))).png().toFile(path.join(root,'media',name));
}
(async()=>{
  const config=JSON.parse(await fs.readFile(path.join(root,'office-assets.json'),'utf8'));
  const requested=process.argv.slice(2);
  for(const state of requested)if(!config.character.actions[state])throw new Error('Unknown state: '+state);
  const report=JSON.parse(await fs.readFile(path.join(root,'extraction.json'),'utf8').catch(()=>'{"faces":{}}'));
  Object.assign(report,{method:'dense-alpha-band-crop-for-local-patches-only',staticBody:'media/character-base.png'});
  report.faces??={};
  for(const [state,action] of Object.entries(config.character.actions)){
    if(requested.length&&!requested.includes(state))continue;
    try{
      const source=await cells(action.source||`face-${state}-original.png`),parts=[],rects=[];
      for(const buffer of source){const patch=await localPatch(buffer);parts.push(await sharp(patch.buffer).resize(90,58,{kernel:'nearest'}).png().toBuffer());rects.push(patch.rect);}
      await atlas(parts,90,58,path.basename(action.face));report.faces[state]={source:action.source||`face-${state}-original.png`,output:action.face,frameSize:[90,58],frameCount:12,sourceRects:rects};
    }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  await fs.writeFile(path.join(root,'extraction.json'),JSON.stringify(report,null,2)+'\n');
  console.log({faceStates:Object.keys(report.faces),hands:'unused, retained as source history only',body:'one unchanged static PNG'});
})();

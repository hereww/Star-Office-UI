#!/usr/bin/env node
/** Offline base-pixel expression restoration; the app reads complete PNGs. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPixelFaceAtlases} from '../assets/character-animation-repairs/2026-10-30-fixed-body/source/offline-pixel-face-animation.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const evidence=path.join(root,'assets/character-animation-repairs/2026-10-30-fixed-body');
const sourceRoot=path.join(evidence,'source');
const runtimeRoot=path.join(root,'frontend/company-office/media/character-breeds');
const args=process.argv.slice(2),options=new Map();
for(let i=0;i<args.length;i+=2){
 if(!['--output-root','--profile','--direction'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Unknown option or missing value: ${args[i]}`);
 if(options.has(args[i]))throw new Error(`Duplicate option: ${args[i]}`);options.set(args[i],args[i+1]);
}
const arg=name=>options.get(name);
const outputRoot=arg('--output-root')?path.resolve(arg('--output-root')):runtimeRoot;
const selectedProfile=arg('--profile'),selectedDirection=arg('--direction');
let require=createRequire(import.meta.url);
try{require.resolve('@napi-rs/canvas');require.resolve('pngjs');}
catch{require=createRequire(process.env.OFFICE_QA_NODE_PACKAGE||path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json'));}
const {createCanvas,loadImage}=require('@napi-rs/canvas'),{PNG}=require('pngjs');
const profiles=['ragdoll-v1','british-shorthair-v1','american-shorthair-v1','tabby-v1','tuxedo-cat-v1','white-lion-cat-v1','jianzhou-cat-v1'];
const directions=['down','left','right','up'],actions=['working','idle','syncing','error'];
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const sources=JSON.parse(fs.readFileSync(path.join(evidence,'sources.json')));
const geometryPath=path.join(sourceRoot,'facial-repair-overrides.json');
const geometry=JSON.parse(fs.readFileSync(geometryPath));
for(const source of sources.files)if(hash(fs.readFileSync(path.join(evidence,source.path)))!==source.sha256)throw new Error(`Historical source checksum mismatch: ${source.path}`);
const report={schemaVersion:2,sourceCommit:sources.sourceCommit,
 buildRendererSha256:hash(fs.readFileSync(path.join(sourceRoot,'offline-pixel-face-animation.mjs'))),
 featureGeometrySha256:hash(fs.readFileSync(geometryPath)),
 contract:'Offline source-eye/mouth repair. Complete 192x192 frames; original alpha, nose, silhouette, body and all pixels outside measured feature regions remain fixed. Rear frames copy base RGBA exactly.',
 buildAdjustments:['Measured original-eye coverage and source-pixel blinking','Original nose retained, old smile fully replaced only during sleep','Source fur samples restore closed eye interiors; dark-fur eyelid contrast','Rear RGBA copies and explicit native-canvas frame snapshots'],records:[]};
const inBox=(x,y,[l,t,r,b])=>x>=l&&x<r&&y>=t&&y<b;
let found=false;
for(const profile of profiles){
 if(selectedProfile&&profile!==selectedProfile)continue;
 const manifest=JSON.parse(fs.readFileSync(path.join(sourceRoot,profile,'manifest.json')));
 for(const direction of directions){
  if(selectedDirection&&direction!==selectedDirection)continue;found=true;
  const baseBytes=fs.readFileSync(path.join(runtimeRoot,profile,direction,'base.png'));
  if(!baseBytes.equals(fs.readFileSync(path.join(sourceRoot,profile,direction,'base.png'))))throw new Error(`${profile}/${direction}: base differs from archived source`);
  const base=PNG.sync.read(baseBytes);if(base.width!==192||base.height!==192)throw new Error('Expected 192x192 base');
  const repair=direction==='up'?null:geometry.profiles[profile][direction];
  const allowed=new Uint8Array(192*192);
  if(repair)for(let y=2;y<190;y++)for(let x=2;x<190;x++){
   if(inBox(x,y,repair.noseBounds)||![...repair.eyeBounds,repair.mouthBounds].some(b=>inBox(x,y,b)))continue;
   let inner=true;
   for(let dy=-2;dy<=2&&inner;dy++)for(let dx=-2;dx<=2;dx++)if(base.data[((y+dy)*192+x+dx)*4+3]<220){inner=false;break;}
   if(inner)allowed[y*192+x]=1;
  }
  const c=manifest.directions[direction];
  let closedEyeSource;
  if(repair?.closedEyeSource){
   const source=repair.closedEyeSource;
   if(source.kind==='complete-frame-crop'){
    const decoded=PNG.sync.read(fs.readFileSync(path.join(sourceRoot,source.path)));
    if(decoded.width!==192||decoded.height!==192)throw new Error('Expected archived complete-frame donor crop');
    // Copy source RGB directly. Compositing this historical alpha over the
    // open-eyed base would blend the original iris back into a closed eye.
    closedEyeSource=decoded.data;
   }else{
   const face=await loadImage(path.join(sourceRoot,source.path));
   const prepared=createCanvas(192,192),ctx=prepared.getContext('2d');ctx.imageSmoothingEnabled=false;
   ctx.drawImage(await loadImage(baseBytes),0,0);
   const [fx,fy,fw,fh]=c.faceRect,[cw,ch]=c.faceFrameSize,f=source.frame;
   ctx.drawImage(face,f%4*cw,Math.floor(f/4)*ch,cw,ch,fx,fy,fw,fh);
   closedEyeSource=ctx.getImageData(0,0,192,192).data;
   }
  }
  const rendered=repair?createPixelFaceAtlases(await loadImage(baseBytes),{...c,repair,closedEyeSource},{createCanvas:()=>createCanvas(1,1)}):null;
  for(const action of actions){
   const atlas=new PNG({width:768,height:576}),frameHashes=[],changes=[];
   const sheet=rendered?.[action].getContext('2d').getImageData(0,0,768,576).data;
   for(let f=0;f<12;f++){
    const cell=Buffer.from(base.data);let changed=0;
    if(sheet)for(let pixel=0;pixel<192*192;pixel++)if(allowed[pixel]){
     const x=pixel%192,y=Math.floor(pixel/192),i=pixel*4,j=((Math.floor(f/4)*192+y)*768+(f%4)*192+x)*4;
     if(sheet[j]!==cell[i]||sheet[j+1]!==cell[i+1]||sheet[j+2]!==cell[i+2])changed++;
     cell[i]=sheet[j];cell[i+1]=sheet[j+1];cell[i+2]=sheet[j+2];
    }
    for(let y=0;y<192;y++)cell.copy(atlas.data,((Math.floor(f/4)*192+y)*768+(f%4)*192)*4,y*192*4,(y+1)*192*4);
    frameHashes.push(hash(cell));changes.push(changed);
   }
   const distinctFrames=new Set(frameHashes).size;
   if(repair&&distinctFrames<2)throw new Error(`${profile}/${direction}/${action}: no expression motion`);
   const output=path.join(outputRoot,profile,direction,`frames-${action}.png`);fs.mkdirSync(path.dirname(output),{recursive:true});
   const bytes=PNG.sync.write(atlas,{deflateStrategy:1,deflateLevel:9});
   if(!fs.existsSync(output)||!fs.readFileSync(output).equals(bytes))fs.writeFileSync(output,bytes);
   report.records.push({profile,direction,action,output:path.relative(root,output),source:repair?'measured-source-pixel-expression':'historical-base-rgba-copy',
    ...(repair?{eyeBounds:repair.eyeBounds,mouthBounds:repair.mouthBounds,noseBounds:repair.noseBounds,closedEyeSource:repair.closedEyeSource??null}:{}),baseSha256:hash(baseBytes),sha256:hash(bytes),distinctFrames,changedFacePixels:changes});
  }
 }
}
if(!found)throw new Error('No matching profile/direction');
const reportName=selectedProfile||selectedDirection?`build-report-${selectedProfile??'all'}-${selectedDirection??'all'}.json`:'build-report.json';
const reportPath=outputRoot===runtimeRoot&&!selectedProfile&&!selectedDirection?path.join(evidence,reportName):path.join(outputRoot,reportName);
fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({atlases:report.records.length,report:reportPath},null,2));

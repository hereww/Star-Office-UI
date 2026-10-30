#!/usr/bin/env node
/** Restore historical expressions into immutable full-frame runtime PNGs.
 * No face atlas or procedural renderer is loaded by the application.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createPixelFaceAtlases} from '../assets/character-animation-repairs/2026-10-30-fixed-body/source/offline-pixel-face-animation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, 'assets/character-animation-repairs/2026-10-30-fixed-body');
const sourceRoot = path.join(evidence, 'source');
const outputRoot = path.join(root, 'frontend/company-office/media/character-breeds');
let require = createRequire(import.meta.url);
try { require.resolve('@napi-rs/canvas'); require.resolve('pngjs'); }
catch { require = createRequire(process.env.OFFICE_QA_NODE_PACKAGE || path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')); }
const {createCanvas, loadImage} = require('@napi-rs/canvas');
const {PNG} = require('pngjs');
const profiles = ['ragdoll-v1','british-shorthair-v1','american-shorthair-v1','tabby-v1','tuxedo-cat-v1','white-lion-cat-v1','jianzhou-cat-v1'];
const directions = ['down','left','right'];
const actions = ['working','idle','syncing','error'];
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const canvas = () => createCanvas(1, 1);
const sources = JSON.parse(fs.readFileSync(path.join(evidence,'sources.json')));
for (const source of sources.files) {
  if (hash(fs.readFileSync(path.join(evidence,source.path))) !== source.sha256) {
    throw new Error(`Historical source checksum mismatch: ${source.path}`);
  }
}
const report = {schemaVersion: 1, sourceCommit: sources.sourceCommit,
  buildRendererSha256: hash(fs.readFileSync(path.join(sourceRoot,'offline-pixel-face-animation.mjs'))),
  buildAdjustments: ['Native-canvas frame snapshots preserve immutable frames', 'Sleep eye sockets reuse existing breed blink lid colours', 'Existing sleep mouth/tongue and side eyelids have a visible one-pixel breathing cycle'],
  contract: 'Offline restoration only. Runtime continues to read complete 192x192 RGBA frames; base alpha, silhouette, ears, body and tail are fixed.',
  records: []};

for (const profile of profiles) {
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot,profile,'manifest.json')));
  for (const direction of directions) {
    const c = manifest.directions[direction];
    const baseFile = path.join(outputRoot,profile,direction,'base.png');
    const baseBytes = fs.readFileSync(baseFile);
    if (!baseBytes.equals(fs.readFileSync(path.join(sourceRoot,profile,direction,'base.png')))) throw new Error(`${profile}/${direction}: base differs from historical source; review geometry first`);
    const decoded = PNG.sync.read(baseBytes);
    const base = await loadImage(baseBytes);
    const procedural = createPixelFaceAtlases(base,c,{createCanvas:canvas});
    const [fx,fy,fw,fh] = c.faceRect, [cx,cy,rx,ry] = c.faceClipEllipse;
    const [cellW,cellH] = c.faceFrameSize;
    const allowed = new Uint8Array(192*192);
    // Keep a two-pixel band inside the source silhouette immutable, including
    // semi-transparent anti-aliasing. Facial fills cannot extend into a cheek,
    // background, ear or whisker even when a generated face is wider.
    for(let y=2;y<190;y++)for(let x=2;x<190;x++) {
      if(x<fx||x>=fx+fw||y<fy||y>=fy+fh||((x+.5-cx)/rx)**2+((y+.5-cy)/ry)**2>1) continue;
      let inner=true;
      for(let dy=-2;dy<=2&&inner;dy++)for(let dx=-2;dx<=2;dx++) if(decoded.data[((y+dy)*192+x+dx)*4+3]<220){inner=false;break;}
      if(inner)allowed[y*192+x]=1;
    }
    for(const action of actions) {
      const face = procedural[action] ?? await loadImage(path.join(sourceRoot,profile,c.actions[action].face.slice(2)));
      const atlas = new PNG({width:768,height:576});
      const frameHashes = [], changes = [];
      for(let frame=0;frame<12;frame++) {
        const work = createCanvas(192,192),ctx=work.getContext('2d');
        ctx.imageSmoothingEnabled=false;ctx.drawImage(base,0,0);
        ctx.save();ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);ctx.clip();
        ctx.drawImage(face,(frame%4)*cellW,Math.floor(frame/4)*cellH,cellW,cellH,fx,fy,fw,fh);ctx.restore();
        const rendered=ctx.getImageData(0,0,192,192).data;
        const cell=Buffer.from(decoded.data);let changed=0;
        for(let pixel=0;pixel<192*192;pixel++)if(allowed[pixel]) {
          const i=pixel*4;
          if(rendered[i]!==cell[i]||rendered[i+1]!==cell[i+1]||rendered[i+2]!==cell[i+2])changed++;
          cell[i]=rendered[i];cell[i+1]=rendered[i+1];cell[i+2]=rendered[i+2];
          // Copy original alpha verbatim; do not re-mask or lift low alpha.
        }
        for(let y=0;y<192;y++)cell.copy(atlas.data,((Math.floor(frame/4)*192+y)*768+(frame%4)*192)*4,y*192*4,(y+1)*192*4);
        frameHashes.push(hash(cell));changes.push(changed);
      }
      const distinctFrames=new Set(frameHashes).size;
      if(distinctFrames<2)throw new Error(`${profile}/${direction}/${action}: restoration has no expression motion`);
      const output=path.join(outputRoot,profile,direction,`frames-${action}.png`);
      // FILTERED deflate finds repeated full-body rows; pngjs' RLE default
      // triples these atlases' transfer size without preserving extra detail.
      const bytes=PNG.sync.write(atlas,{deflateStrategy:1,deflateLevel:9});fs.writeFileSync(output,bytes);
      report.records.push({profile,direction,action,output:path.relative(root,output),source:procedural[action]?'historical-code-expression':'historical-generated-idle',
        faceRect:c.faceRect,faceClipEllipse:c.faceClipEllipse,baseSha256:hash(baseBytes),sha256:hash(bytes),distinctFrames,changedFacePixels:changes});
    }
  }
}
fs.writeFileSync(path.join(evidence,'build-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({atlases:report.records.length,minimumDistinctFrames:Math.min(...report.records.map(x=>x.distinctFrames)),report:path.join(evidence,'build-report.json')},null,2));

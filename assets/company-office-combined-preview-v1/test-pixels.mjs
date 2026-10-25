/** Exact lossless compositor pixel check. Browser screenshots are lossy JPEG and checked visually. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SeatedOfficePlayer, BUSINESS_STATES } from '../../frontend/company-office/seated-compositor.mjs';
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const config = JSON.parse(readFileSync(new URL('../../frontend/company-office/office-assets.json', import.meta.url)));
const player = await new SeatedOfficePlayer(createCanvas(192,192), config, {
  baseUrl:new URL('../../frontend/company-office/',import.meta.url).href,
  imageLoader:url=>loadImage(fileURLToPath(url))
}).initialize();
const hashes=[],states=[];
const [bx,by]=player.bodyPlacement(),[cx,cy,rx,ry]=config.character.faceClipEllipse,scale=config.character.scale;
for(const state of Object.keys(BUSINESS_STATES)){
  player.setState(state);const faceHashes=[];
  for(let frame=0;frame<12;frame++){
    player.setFrame(frame);const pixels=player.ctx.getImageData(0,0,192,192).data,outside=[],inside=[];
    for(let y=0;y<192;y++)for(let x=0;x<192;x++){
      const inFace=((x+.5-(bx+cx*scale))/(rx*scale+1))**2+((y+.5-(by+cy*scale))/(ry*scale+1))**2<=1;
      for(let c=0;c<4;c++)(inFace?inside:outside).push(pixels[(y*192+x)*4+c]);
    }
    hashes.push(createHash('sha256').update(Buffer.from(outside)).digest('hex'));
    faceHashes.push(createHash('sha256').update(Buffer.from(inside)).digest('hex'));
    assert.equal(player.snapshot().handsRendered,false);assert.equal(player.snapshot().bodyFixed,true);
  }
  states.push({state,action:BUSINESS_STATES[state],frames:12,distinctFaceImages:new Set(faceHashes).size});
}
assert.equal(new Set(hashes).size,1,'Body, chair and desk pixels changed outside face');
const walk=[];
for(const direction of ['up','down','left','right']){
  const pair=[];
  for(const phase of ['A','B']){
    const image=await loadImage(fileURLToPath(new URL(`../../.agents/skills/star-office-character-animation/assets/approved-walk-directions-v1/${direction}/${phase}.png`,import.meta.url)));
    assert.equal(image.width,96);assert.equal(image.height,96);
    const canvas=createCanvas(96,96),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    const data=ctx.getImageData(0,0,96,96).data;let transparent=0,painted=0;
    for(let i=3;i<data.length;i+=4){if(data[i]===0)transparent++;if(data[i]>0)painted++;}
    assert.ok(transparent>96*96*.3&&painted>100);
    pair.push(createHash('sha256').update(data).digest('hex'));
  }
  assert.equal(new Set(pair).size,2);walk.push({direction,uniquePoses:2,trueAlpha:true});
}
const result={passed:true,method:'lossless-native-canvas-same-source-compositor',checkedOfficeFrames:72,states,
  bodyAndFurnitureFixedOutsideFace:true,handsRendered:false,walkDirections:walk,walkingFramesPerDirection:2,
  full12FrameWalkAvailable:false,browserScreenshotPixelsNotUsedForExactHash:true};
writeFileSync(new URL('./pixel-qa.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));

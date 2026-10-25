#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import {measureOfficeRendering,prepareOfficeRendering,OfficeRenderQuality,OFFICE_TEXT_FONT} from '../frontend/company-office/reference-v3/render-quality.mjs';
function viewport(w,h,fn){const before=[globalThis.innerWidth,globalThis.innerHeight];globalThis.innerWidth=w;globalThis.innerHeight=h;try{return fn();}finally{[globalThis.innerWidth,globalThis.innerHeight]=before;}}
const element=(w,h)=>({getBoundingClientRect:()=>({width:w,height:h})});
test('ordinary desktop stays at native density rather than allocating unnecessary 4K buffers',()=>viewport(1440,1000,()=>{
 const m=measureOfficeRendering(element(1074,780),{dpr:1,mobile:false});assert.equal(m.density,1);assert.deepEqual(m.backingSize,[1074,780]);assert.equal(m.capped,false);
}));
test('3840 desktop has a real 4K backing even after the sidebar consumes CSS width',()=>viewport(3840,2160,()=>{
 const m=measureOfficeRendering(element(3380,1972),{dpr:1,mobile:false});assert.ok(m.backingSize[0]>=3840&&m.backingSize[1]>=2160);assert.ok(m.density>1);assert.equal(m.fourKTarget,true);
}));
test('1920 Retina display also gets at least 3840x2160 real pixels',()=>viewport(1920,1080,()=>{
 const m=measureOfficeRendering(element(1538,916),{dpr:2,mobile:false});assert.deepEqual(m.backingSize,[3840,2287]);assert.ok(m.density>=2);assert.equal(m.fourKTarget,true);
}));
test('portrait and landscape phones retain their DPR without a forced huge desktop allocation',()=>{
 for(const [w,h,cw,ch]of [[390,844,358,510],[844,390,812,260]])viewport(w,h,()=>{const m=measureOfficeRendering(element(cw,ch),{dpr:3,mobile:true});assert.equal(m.density,3);assert.equal(m.fourKTarget,false);assert.deepEqual(m.backingSize,[cw*3,ch*3]);});
});
test('extreme desktop DPR is capped by both axis and pixel allocation budget',()=>viewport(7680,4320,()=>{
 const m=measureOfficeRendering(element(7280,4050),{dpr:3,mobile:false});assert.equal(m.capped,true);assert.ok(m.backingSize.every(x=>x<=8192));assert.ok(m.backingSize[0]*m.backingSize[1]<=7680*4320+16384);assert.ok(m.backingSize.every(x=>x>=2160));
}));
test('zero-size startup containers never produce zero or nonfinite backing dimensions',()=>viewport(0,0,()=>{
 const m=measureOfficeRendering(element(0,0),{dpr:2,mobile:false});assert.deepEqual(m.backingSize,[2,2]);assert.equal(m.density,2);
}));
test('preparing Phaser uses explicit physical game size, not RESIZE reverting to CSS pixels',()=>viewport(1920,1080,()=>{
 const previousDpr=globalThis.devicePixelRatio;globalThis.devicePixelRatio=2;
 try{const config={width:1,height:1,scale:{mode:2}};const size=prepareOfficeRendering(config,element(1538,916),{Scale:{NONE:0,NO_CENTER:0}});assert.deepEqual([config.width,config.height],size.backingSize);assert.equal(config.scale.mode,0);assert.equal(config.scale.autoRound,false);}finally{globalThis.devicePixelRatio=previousDpr;}
}));
test('screen-space text remains the same readable size through camera zoom and uses high-DPI rasterization',()=>viewport(1920,1080,()=>{
 const q=Object.create(OfficeRenderQuality.prototype),canvas={width:3840,getBoundingClientRect:()=>({width:1538,height:916})};
 q.scene={cameras:{main:{zoom:3}},sys:{game:{canvas}}};
 const text={style:{resolution:1},setFontSize(v){this.fontSize=parseFloat(v);return this;},setScale(v){this.scale=v;return this;},setResolution(v){this.style.resolution=v;return this;}};
 for(const zoom of [0.7,1,3,7.8]){q.scene.cameras.main.zoom=zoom;q.styleText(text,14);assert.ok(Math.abs(text.fontSize*text.scale*zoom/q.density-14)<0.000001);assert.equal(text.style.resolution,3);}
 assert.ok(!/ArkPixel/i.test(OFFICE_TEXT_FONT));assert.ok(OFFICE_TEXT_FONT.includes('PingFang SC'));
}));

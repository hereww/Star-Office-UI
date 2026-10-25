import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeCharacterProfileAssets} from '../frontend/company-office/character-profile-assets.mjs';
const root=new URL('../frontend/company-office/',import.meta.url);
const read=path=>JSON.parse(readFileSync(new URL(path,root),'utf8'));
const original=read('reference-v3/assets.json');
for(const id of Object.keys(read('character-profile-assets.json').profiles)){
 test(`${id}: four directions replace character only and preserve furniture`,()=>{
  const manifest=read(`media/character-breeds/${id}/manifest.json`),before=structuredClone(original);
  const actual=mergeCharacterProfileAssets(original,manifest,`https://qa.invalid/media/character-breeds/${id}/manifest.json`,id);
  for(const direction of ['up','down','left','right']){
   const c=actual.directions[direction].character;
   assert.equal(c.id,id);assert.equal(c.direction,direction);
   assert.deepEqual(actual.directions[direction].furniture,before.directions[direction].furniture);
   assert.equal(c.faceVisible,direction!=='up');
   for(const [action,clock] of Object.entries({working:60,idle:36,syncing:60,error:12})){
    assert.equal(c.actions[action].clockFrames,clock);
    assert.equal(c.actions[action].frameCount,12); assert.equal(c.actions[action].fps,12);
    assert.match(c.actions[action].frames,new RegExp(`/${direction}/frames-${action}\\.png$`));
    assert.equal('face' in c.actions[action],false);
   }
  }
  assert.deepEqual(original,before);
 });
}
test('reject mismatched identity, absent direction, bad timing and unsafe asset paths',()=>{
 const manifest=read('media/character-breeds/ragdoll-v1/manifest.json'),url='https://qa.invalid/ragdoll-v1/manifest.json';
 for(const modify of [m=>m.profileId='other',m=>delete m.directions.left,m=>m.directions.down.actions.working.clockFrames=12,m=>m.directions.down.base='https://evil.invalid/a.png',m=>m.directions.down.base='../private/token.png',m=>m.directions.up.actions.idle.frames='../private/token.png']){
  const bad=structuredClone(manifest);modify(bad);assert.throws(()=>mergeCharacterProfileAssets(original,bad,url,'ragdoll-v1'));
 }
});

test('full-frame manifests reject invalid frame contracts and rear faces', () => {
 const manifest=read('media/character-breeds/american-shorthair-v1/manifest.json');
 const url='https://qa.invalid/american-shorthair-v1/manifest.json';
 for (const modify of [
  m=>m.directions.down.actions.working.frameCount=11,
  m=>m.directions.down.actions.working.fps=24,
  m=>m.directions.down.actions.working.frames='../private/frame.png',
  m=>m.directions.up.faceVisible=true,
  m=>m.directions.down.animationMode='expression-only',
 ]) {
  const bad=structuredClone(manifest);modify(bad);
  assert.throws(()=>mergeCharacterProfileAssets(original,bad,url,'american-shorthair-v1'));
 }
});

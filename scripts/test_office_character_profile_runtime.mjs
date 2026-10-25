import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ConnectedOfficeRuntime,attachBenchContacts} from '../frontend/company-office/connected-v5/runtime.mjs';
import {ConnectedSeatedPlayer} from '../frontend/company-office/connected-v5/seated-player.mjs';
import {benchTransform,normalizeBenchManifest,validateBenchManifest} from '../frontend/company-office/connected-v5/furniture-contract.mjs';
import {mergeCharacterProfileAssets} from '../frontend/company-office/character-profile-assets.mjs';
import {characterPortraitUrl} from '../frontend/company-office/character-profile-runtime.mjs';
const root=new URL('../',import.meta.url),read=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));
const assets=read('frontend/company-office/reference-v3/assets.json'),layout=read('frontend/company-office/connected-v5/layout.json');
const records=layout.benches.map(spec=>{const manifest=validateBenchManifest(normalizeBenchManifest(read(`frontend/company-office/connected-v5/${spec.manifest}`),spec),spec);return {spec,manifest,transform:benchTransform(manifest,spec.fit),image:{}};});
function canvas(){const ctx={imageSmoothingEnabled:false};for(const key of ['clearRect','drawImage','save','restore','beginPath','ellipse','rect','clip'])ctx[key]=()=>{};return {getContext:()=>ctx};}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {resolve,reject,promise};};
test('portrait resolver stays on the approved profile asset allowlist',()=>{
 const orange=characterPortraitUrl('orange-cat-v1');
 assert.ok(orange.endsWith('/frontend/company-office/media/character-base.png'));
 assert.ok(characterPortraitUrl('ragdoll-v1').endsWith('/frontend/company-office/media/character-breeds/ragdoll-v1/down/base.png'));
 assert.ok(characterPortraitUrl('unknown-profile').endsWith('/frontend/company-office/media/character-base.png'));
 assert.notEqual(characterPortraitUrl('ragdoll-v1'),orange);
});
async function fixture(){
 const r=new ConnectedOfficeRuntime(attachBenchContacts(layout,assets,records),assets,new URL('frontend/company-office/connected-v5/',root).href);r.benches=records;
 const prepare=async(a,d)=>new ConnectedSeatedPlayer(canvas(),a,{direction:d,imageLoader:async url=>({width:url.includes('frames-')?768:192,height:url.includes('frames-')?576:192})}).initialize();
 for(const s of r.stations){s.player=await prepare(assets,s.direction);s.renderedCharacterProfileId='orange-cat-v1';s.requestedCharacterProfileId='orange-cat-v1';r.attachPlayerToBench(s,s.player);s.texture={refresh(){}};}
 r.player=r.getStation(layout.mainStation).player;r.prepareCharacterPlayer=prepare;
 r.characterAssetsForProfile=async id=>id==='orange-cat-v1'?assets:mergeCharacterProfileAssets(assets,read(`frontend/company-office/media/character-breeds/${id}/manifest.json`),new URL(`frontend/company-office/media/character-breeds/${id}/manifest.json`,root).href,id);
 return {r,s:r.getStation('desk-09')};
}
test('latest profile request wins and commits matching metadata',async()=>{
 const {r,s}=await fixture(),load=r.characterAssetsForProfile,first=deferred();r.characterAssetsForProfile=id=>id==='ragdoll-v1'?first.promise:load(id);
 const a=r.setStationCharacterProfile(s.id,'ragdoll-v1');await r.setStationCharacterProfile(s.id,'british-shorthair-v1');first.resolve(await load('ragdoll-v1'));assert.equal(await a,false);assert.equal(s.renderedCharacterProfileId,'british-shorthair-v1');assert.equal(s.player.spec.character.id,'british-shorthair-v1');
});
test('returning to rendered breed cancels a pending alternate',async()=>{
 const {r,s}=await fixture(),load=r.characterAssetsForProfile,p=deferred(),old=s.player;r.characterAssetsForProfile=()=>p.promise;
 const a=r.setStationCharacterProfile(s.id,'ragdoll-v1');await r.setStationCharacterProfile(s.id,'orange-cat-v1');p.resolve(await load('ragdoll-v1'));assert.equal(await a,false);assert.equal(s.player,old);assert.equal(s.requestedCharacterProfileId,'orange-cat-v1');
});
test('failed replacement keeps previous pixels and can retry',async()=>{
 const {r,s}=await fixture(),load=r.characterAssetsForProfile,old=s.player;r.characterAssetsForProfile=async()=>{throw new Error('unavailable');};
 await assert.rejects(r.setStationCharacterProfile(s.id,'ragdoll-v1'));assert.equal(s.player,old);assert.equal(s.renderedCharacterProfileId,'orange-cat-v1');assert.equal(s.characterProfilePending,null);assert.ok(s.characterLoadError);
 r.characterAssetsForProfile=load;await r.setStationCharacterProfile(s.id,'ragdoll-v1');assert.equal(s.renderedCharacterProfileId,'ragdoll-v1');assert.equal(s.characterLoadError,null);
});
test('direction, latest state, presentation, reduced motion and elapsed clock survive preload',async()=>{
 const {r,s}=await fixture(),load=r.characterAssetsForProfile,p=deferred();r.characterAssetsForProfile=()=>p.promise;
 const a=r.setStationCharacterProfile(s.id,'ragdoll-v1');s.direction='left';s.state='syncing';s.epoch=125;r.reducedMotion=true;s.presentation={actorVisible:false,neutral:true};
 p.resolve(await load('ragdoll-v1'));await a;assert.equal(s.player.direction,'left');assert.equal(s.player.state,'syncing');assert.equal(s.player.actorVisible,false);assert.equal(s.player.neutral,true);assert.equal(s.player.reducedMotion,true);assert.equal(s.epoch,125);assert.deepEqual(s.player.benchContext.center,s.center);
});
test('duplicate pending profile shares preparation; destroyed adapter cannot commit',async()=>{
 const {r,s}=await fixture(),load=r.characterAssetsForProfile,p=deferred(),old=s.player;let calls=0;r.characterAssetsForProfile=()=>{calls++;return p.promise;};
 const a=r.setStationCharacterProfile(s.id,'ragdoll-v1'),b=r.setStationCharacterProfile(s.id,'ragdoll-v1');assert.equal(calls,1);r.adapter={destroyed:true};r.profileLifetime=1;p.resolve(await load('ragdoll-v1'));assert.equal(await a,false);assert.equal(await b,false);assert.equal(s.player,old);
});

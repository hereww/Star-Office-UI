import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DIRECTIONS,STATES,ROOT,assertScreenOnly,recordedPlayer} from './connected_v5_qa_helpers.mjs';

for(const direction of DIRECTIONS) test(`${direction}: all six states preserve the original face clock with no hand layer`,async()=>{
  const {player,canvas,assertBalanced}=await recordedPlayer({direction});
  const baseline=await recordedPlayer({direction,Player:(await import('../frontend/company-office/connected-v4/seated-player.mjs')).ConnectedSeatedPlayer});
  assert.deepEqual([canvas.width,canvas.height],[192,192]);
  for(const state of STATES)for(const ms of [0,84,1000,3000,5000,5084,10000]){
    player.setState(state);baseline.player.setState(state);player.sample(ms);baseline.player.sample(ms);assertScreenOnly(player);
    for(const k of ['frame','faceFrame','fps','clock','action','bodyPlacement','poseAnchor','seatAnchor','faceVisible'])
      assert.deepEqual(player.snapshot()[k],baseline.player.snapshot()[k],`${direction}/${state}/${ms}/${k}`);
    assert.deepEqual(player._screen().polygon,[]);assert.equal(player._screen().external,true);assertBalanced();
  }
});

test('full-frame atlas cells redraw without procedural primitives',async()=>{
  for(const direction of DIRECTIONS){const {player,calls}=await recordedPlayer({direction});
    for(const state of STATES){const signatures=[];player.setState(state);
      for(const frame of [0,3,6,9,11]){player.setFrame(frame);player.faceFrame=0;player._drawKey=null;calls.length=0;player._render();signatures.push(JSON.stringify(calls));assertScreenOnly(player);}
      assert.ok(signatures.every(signature=>signature.includes('drawImage')),`${direction}/${state}: each frame must draw a complete atlas cell`);
      assert.equal(new Set(signatures.map(signature=>signature.match(/drawImage/g)?.length)).size,1,`${direction}/${state}: draw order must stay fixed`);
    }
  }
});
test('full-frame state clocks hold after the first 12 frames and restart on their declared cycle',async()=>{
  const {player}=await recordedPlayer({direction:'right'});
  const msAt=tick=>tick*1000/12+0.00001;
  for(const [state,clock] of [['writing',60],['idle',36],['syncing',60],['error',12]]){
    player.setState(state);
    player.sample(msAt(11)); assert.equal(player.snapshot().frame,11,`${state}: final animated frame`);
    player.sample(msAt(12)); assert.equal(player.snapshot().frame,0,`${state}: hold starts at frame 0`);
    player.sample(msAt(clock-1)); assert.equal(player.snapshot().frame,clock===12?11:0,`${state}: clock hold`);
    player.sample(msAt(clock)); assert.equal(player.snapshot().frame,0,`${state}: cycle restarts`);
    assert.equal(player.snapshot().clock,clock);
  }
});
test('reduced-motion and visible/hidden/neutral presentations cannot resurrect keyboard interaction',async()=>{
  for(const direction of DIRECTIONS){const {player}=await recordedPlayer({direction});
    for(const reducedMotion of [false,true])for(const presentation of [{actorVisible:true,neutral:false},{actorVisible:false,neutral:false},{actorVisible:true,neutral:true}]){
      player.setReducedMotion(reducedMotion);player.setPresentation(presentation);
      for(const state of STATES){player.setState(state);player.sample(500);assertScreenOnly(player);}
    }
  }
});
test('actor source has no dependency on deleted hand-animation code',()=>{
  for(const file of ['seated-player.mjs','runtime.mjs']){
    const text=readFileSync(resolve(ROOT,'frontend/company-office/connected-v5',file),'utf8');
    assert.doesNotMatch(text,/from\s+['"]\.\/working-hands\.mjs/);
    assert.doesNotMatch(text,/drawWorkingHands|WorkingHandsLayer|keyboardContextForStation/);
  }
});

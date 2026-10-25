import {SeatedOfficePlayer} from './seated-compositor.mjs';
const $=id=>document.getElementById(id);let player,demos=[],playing=true,epoch=performance.now(),raf;
const config=await fetch('./office-assets.json').then(r=>r.json());
function clone(canvas){const p=new SeatedOfficePlayer(canvas,config);p.images=player.images;return p}
function refresh(){
  const snap=player.snapshot();$('office').setAttribute('data-snapshot',JSON.stringify(snap));
  $('frame').textContent=`表情 ${String(snap.faceFrame+1).padStart(2,'0')}/12`;
  const text=`${snap.state} → ${snap.action} · ${config.character.actions[snap.action].label} · 仅表情 · 无手部图层 · 坐姿锁定`;
  if($('status').textContent!==text)$('status').textContent=text;
}
function pause(){playing=false;$('play').textContent='播放'}
function strip(){
  $('strip').replaceChildren();const p=clone(document.createElement('canvas'));p.setState(player.state);
  for(let i=0;i<12;i++){const button=document.createElement('button'),canvas=document.createElement('canvas'),span=document.createElement('span');canvas.width=canvas.height=192;p.setFrame(i);canvas.getContext('2d').drawImage(p.canvas,0,0);span.textContent=String(i+1).padStart(2,'0');button.setAttribute('aria-label',`查看第${i+1}帧`);button.append(canvas,span);button.addEventListener('click',()=>{pause();player.setFrame(i);refresh()});$('strip').append(button);}
}
function setState(state){player.setState(state);$('state').value=state;epoch=performance.now();for(const button of document.querySelectorAll('#states button'))button.setAttribute('aria-pressed',String(button.dataset.state===state||(['writing','researching','executing'].includes(state)&&button.dataset.state==='writing')));strip();refresh()}
function tick(now){if(playing){player.sample(now-epoch);for(const p of demos)p.sample(now-epoch)}refresh();raf=requestAnimationFrame(tick)}
try{
  player=await new SeatedOfficePlayer($('office'),config,{baseUrl:location.href}).initialize();
  for(const canvas of document.querySelectorAll('[data-demo]')){const p=clone(canvas);p.setState(canvas.dataset.demo);demos.push(p);}
  strip();for(const id of ['play','step','reset','state','view'])$(id).disabled=false;
  $('play').addEventListener('click',()=>{playing=!playing;$('play').textContent=playing?'暂停':'播放';epoch=performance.now()-player.frame*1000/config.fps;refresh()});
  $('step').addEventListener('click',()=>{pause();player.setFrame((player.frame+1)%12);refresh()});
  $('reset').addEventListener('click',()=>{epoch=performance.now();player.setFrame(0);refresh()});
  $('state').addEventListener('change',()=>setState($('state').value));
  for(const button of document.querySelectorAll('[data-state]'))button.addEventListener('click',()=>setState(button.dataset.state));
  $('view').addEventListener('change',()=>{player.view=$('view').value;player.draw();refresh()});
  for(const [id,key] of [['face','faceEnabled'],['body','visibleCharacter']])$(id).addEventListener('change',()=>{player[key]=$(id).checked;player.draw();refresh()});
  epoch=performance.now();raf=requestAnimationFrame(tick);
}catch(e){$('error').textContent=e.message}
window.addEventListener('pagehide',()=>cancelAnimationFrame(raf));

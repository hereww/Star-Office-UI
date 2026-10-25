import {OfficeCompositor} from './office-compositor.mjs';
const $ = id => document.getElementById(id);
const config = await fetch('./office-assets.json').then(r=>{if(!r.ok)throw new Error('素材描述未找到');return r.json()});
const compositor = new OfficeCompositor($('office'), config.workstation, {baseUrl:location.href});
let playing = true, epoch = performance.now(), raf, uploadedUrls = [], imported = null;
const actorCanvas = $('actor-layer'), actorCtx = actorCanvas.getContext('2d');
function refresh() {
  const snap = compositor.snapshot();
  $('position').textContent = `${String(snap.frame+1).padStart(2,'0')} / 12 · ${snap.fps || 12}fps`;
  const status = !snap.characterId ? '角色已移除；桌子和电脑完全不变。' : snap.available
    ? `${snap.state} → ${snap.action} · 固定工位 ${snap.workstationId}`
    : `${snap.state} 暂无角色动作素材，只显示工位；不把办公稿冒充其他状态。`;
  if($('status').textContent!==status) $('status').textContent=status;
  actorCtx.clearRect(0,0,192,192); actorCtx.imageSmoothingEnabled=false;
  compositor.drawCharacter(actorCtx);
  $('office').dataset.snapshot = JSON.stringify(snap);
}
function pause() {playing=false; $('play').textContent='播放'; refresh();}
function drawStrip() {
  $('strip').replaceChildren();
  const clone = new OfficeCompositor(document.createElement('canvas'), config.workstation);
  clone.back=compositor.back; clone.front=compositor.front; clone.characters=compositor.characters;
  clone.characterId=compositor.characterId; clone.state=compositor.state;
  for(let i=0;i<12;i++) {
    const button=document.createElement('button'), label=document.createElement('span');
    button.setAttribute('aria-label',`查看第${i+1}帧`);
    const canvas=document.createElement('canvas'); canvas.width=192;canvas.height=192;
    clone.setFrame(i); canvas.getContext('2d').drawImage(clone.canvas,0,0);
    label.textContent=String(i+1).padStart(2,'0');button.append(canvas,label);
    button.addEventListener('click',()=>{pause();compositor.setFrame(i);refresh()});
    $('strip').append(button);
  }
}
function tick(time) {
  if(playing) compositor.sample(time-epoch);
  refresh(); raf=requestAnimationFrame(tick);
}
try {
  await compositor.initialize();
  await compositor.registerCharacter(config.characters[0]);
  compositor.setCharacter('orange-cat'); drawStrip();
  for(const id of ['character','state','view','play','step','reset','import']) $(id).disabled=false;
  $('play').addEventListener('click',()=>{playing=!playing;epoch=performance.now()-compositor.frame*1000/12;$('play').textContent=playing?'暂停':'播放';refresh()});
  $('step').addEventListener('click',()=>{pause();compositor.setFrame((compositor.frame+1)%12);refresh()});
  $('reset').addEventListener('click',()=>{epoch=performance.now();compositor.setFrame(0);refresh()});
  $('character').addEventListener('change',()=>{compositor.setCharacter($('character').value==='none'?null:$('character').value);epoch=performance.now();drawStrip();refresh()});
  $('state').addEventListener('change',()=>{compositor.setState($('state').value);epoch=performance.now();drawStrip();refresh()});
  $('view').addEventListener('change',()=>{compositor.view=$('view').value;compositor.draw();refresh()});
  $('guides').addEventListener('change',()=>{compositor.guides=$('guides').checked;compositor.draw();refresh()});
  $('import').addEventListener('click',async()=>{
    $('error').textContent=''; const file=$('sprite-file').files[0];let url;
    try {
      if(!file)throw new Error('请选择透明4×3办公图集');
      if(file.size>20*1024*1024)throw new Error('图集不能超过20MB');
      if(!['image/png','image/webp'].includes(file.type))throw new Error('只支持PNG或WebP');
      const descriptorFile=$('descriptor-file').files[0];
      let character = descriptorFile ? JSON.parse(await descriptorFile.text()) : structuredClone(config.characters[0]);
      // Local import supports one working sheet; it never fetches arbitrary URLs from a descriptor.
      character.id='local-character';character.label='本地替换角色';
      if(!character.actions?.working)throw new Error('角色描述缺少working');
      url=URL.createObjectURL(file);const image=new Image();image.src=url;await image.decode();
      const probe=document.createElement('canvas');probe.width=image.width;probe.height=image.height;
      if(image.width>4096||image.height>4096)throw new Error('图集边长不能超过4096px');
      const probeCtx=probe.getContext('2d',{willReadFrequently:true});probeCtx.drawImage(image,0,0);
      const data=probeCtx.getImageData(0,0,image.width,image.height).data;
      let transparent=0;for(let i=3;i<data.length;i+=4)if(data[i]===0)transparent++;
      if(!transparent)throw new Error('没有实际透明背景；不接受绘制的棋盘格背景');
      const grid=character.actions.working.grid;
      if(!Array.isArray(grid)||grid.length!==2||grid[0]!==4||grid[1]!==3)throw new Error('预览导入需4×3图集');
      character.actions={working:{...character.actions.working,sheet:url,frameSize:[image.width/4,image.height/3]}};
      // Descriptor pose anchor must use the source atlas cell's native pixel coordinates.
      if(!descriptorFile){
        const factor=(image.width/4)/192;
        if(image.width/4!==image.height/3)throw new Error('每格应为正方形');
        character.poseAnchor=character.poseAnchor.map(n=>n*factor);character.scale/=factor;
      }
      await compositor.registerCharacter(character);compositor.setCharacter(character.id);
      if(imported){for(const old of uploadedUrls)URL.revokeObjectURL(old);uploadedUrls=[];}
      uploadedUrls.push(url);imported=character;
      let option=$('character').querySelector('option[value="local-character"]');
      if(!option){option=new Option('本地替换角色','local-character');$('character').add(option);}
      $('character').value=character.id;epoch=performance.now();drawStrip();refresh();
    } catch(e){if(url)URL.revokeObjectURL(url);$('error').textContent=e.message;}
  });
  epoch=performance.now();raf=requestAnimationFrame(tick);
} catch(e){$('error').textContent=e.message;}
window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);for(const url of uploadedUrls)URL.revokeObjectURL(url)});

/** Deterministic atlas extraction only; no repaint, per-frame registration or repairs. */
const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = __dirname;
const cell = 192;
async function split(source, cols, rows, names, output) {
  const meta = await sharp(source).metadata();
  if (meta.width % cols || meta.height % rows || meta.width / cols !== meta.height / rows) {
    throw new Error(`Expected equal square cells: ${meta.width}x${meta.height}, ${cols}x${rows}`);
  }
  const cw = meta.width / cols;
  const ch = meta.height / rows;
  for (let i = 0; i < names.length; i++) {
    await sharp(source).extract({left: (i % cols) * cw, top: Math.floor(i / cols) * ch, width: cw, height: ch})
      .resize(cell, cell, {kernel:'nearest'}).png().toFile(path.join(root,output,names[i]));
  }
  return {source_width:meta.width,source_height:meta.height,source_cell:[cw,ch],target_cell:[cell,cell],grid:[cols,rows]};
}
(async()=>{
  const station = await split(path.join(root,'source/workstation-layers-original.png'),2,1,
    ['workstation-back.png','workstation-front.png'],'media');
  await sharp({create:{width:cell,height:cell,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
    .composite([{input:path.join(root,'media/workstation-back.png')},{input:path.join(root,'media/workstation-front.png')}])
    .png().toFile(path.join(root,'media/workstation-reference.png'));
  let actor = null;
  try {
    await fs.access(path.join(root,'source/orange-cat-working-original.png'));
    const names = Array.from({length:12},(_,i)=>`${String(i+1).padStart(2,'0')}.png`);
    actor = await split(path.join(root,'source/orange-cat-working-original.png'),4,3,names,'frames');
    const layers = names.map((name,i)=>({input:path.join(root,'frames',name),left:i%4*cell,top:Math.floor(i/4)*cell}));
    await sharp({create:{width:cell*4,height:cell*3,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
      .composite(layers).png().toFile(path.join(root,'media/orange-cat-working.png'));
  } catch(e) { if (e.code !== 'ENOENT') throw e; }
  await fs.writeFile(path.join(root,'extraction.json'),JSON.stringify({station,actor,method:'equal-grid-nearest-no-individual-registration'},null,2)+'\n');
  console.log({station,actor});
})();

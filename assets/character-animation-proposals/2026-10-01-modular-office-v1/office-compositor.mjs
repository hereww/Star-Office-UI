/** Standalone candidate compositor. No production scene/state API changes. */
export const BUSINESS_STATES = Object.freeze({
  idle: 'idle', writing: 'working', researching: 'working', executing: 'working',
  syncing: 'syncing', error: 'error',
});
const CARDINAL = new Set(['up', 'down', 'left', 'right']);
function finitePair(value, name, positive = false) {
  if (!Array.isArray(value) || value.length !== 2 || value.some(n => !Number.isFinite(n) || (positive && n <= 0)))
    throw new Error(`${name} 必须是两个${positive ? '正' : '有限'}数值`);
}
export function validateCharacter(character, station) {
  if (!character || typeof character.id !== 'string' || !character.id.trim()) throw new Error('角色必须有 id');
  if (!CARDINAL.has(character.direction) || character.direction !== station.direction) throw new Error('角色与工位朝向不一致');
  finitePair(character.poseAnchor, 'poseAnchor');
  if (!(Number.isFinite(character.scale) && character.scale > 0 && character.scale <= 4)) throw new Error('角色 scale 应在 (0,4]');
  if (!character.actions || !Object.keys(character.actions).length) throw new Error('角色缺少动作图集');
  for (const [name, action] of Object.entries(character.actions)) {
    if (!Object.values(BUSINESS_STATES).includes(name)) throw new Error(`未知视觉动作 ${name}`);
    finitePair(action.frameSize, 'frameSize', true);
    if (action.frameSize.some(n => !Number.isInteger(n))) throw new Error('单格像素尺寸必须是整数');
    if (!Array.isArray(action.grid) || action.grid.length !== 2 || action.grid.some(n => !Number.isInteger(n) || n <= 0)) throw new Error('grid 必须是正整数列/行');
    if (action.frameCount !== 12 || action.grid[0] * action.grid[1] !== 12) throw new Error('每个动作必须有12格，不用2张图凑帧');
    if (!Number.isFinite(action.fps) || action.fps <= 0 || action.fps > 60) throw new Error('fps 无效');
    if (typeof action.sheet !== 'string' || !action.sheet) throw new Error('动作缺少 sheet');
  }
}
export async function loadImage(url) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}
export class OfficeCompositor {
  constructor(canvas, station, {baseUrl = import.meta.url, imageLoader = loadImage} = {}) {
    if (!CARDINAL.has(station.direction)) throw new Error('工位仅支持上下左右');
    finitePair(station.size, 'station.size', true);
    finitePair(station.seatAnchor, 'station.seatAnchor');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('Canvas 2D 不可用');
    canvas.width = station.size[0]; canvas.height = station.size[1];
    this.station = structuredClone(station);
    this.baseUrl = baseUrl;
    this.imageLoader = imageLoader;
    this.characters = new Map();
    this.state = 'writing'; this.characterId = null; this.frame = 0;
    this.view = 'combined'; this.guides = false;
  }
  async initialize() {
    [this.back, this.front] = await Promise.all(['back', 'front'].map(async key => {
      const image = await this.imageLoader(new URL(this.station[key], this.baseUrl).href);
      if (image.width !== this.station.size[0] || image.height !== this.station.size[1]) throw new Error('工位前后层必须使用相同完整画布');
      return image;
    }));
    this.draw();
    return this;
  }
  async registerCharacter(character) {
    validateCharacter(character, this.station);
    // Load and validate completely before mutating the registry; a bad upload keeps the current character.
    const actions = {};
    for (const [name, spec] of Object.entries(character.actions)) {
      const image = await this.imageLoader(new URL(spec.sheet, this.baseUrl).href);
      if (image.width !== spec.frameSize[0] * spec.grid[0] || image.height !== spec.frameSize[1] * spec.grid[1]) throw new Error('图集尺寸与帧规格不符');
      actions[name] = {...spec, image};
    }
    this.characters.set(character.id, {...structuredClone(character), actions});
  }
  setCharacter(id) {
    if (id !== null && !this.characters.has(id)) throw new Error(`未注册角色 ${id}`);
    this.characterId = id; this.frame = 0; this.draw();
  }
  setState(state) {
    if (!Object.hasOwn(BUSINESS_STATES, state)) throw new Error('只接受系统原有六种业务状态');
    this.state = state; this.frame = 0; this.draw();
  }
  setFrame(frame) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= 12) throw new Error('帧索引必须在0..11');
    this.frame = frame; this.draw();
  }
  sample(elapsedMs) {
    const action = this.currentAction();
    if (!action) return;
    this.frame = Math.floor(Math.max(0, elapsedMs) * action.fps / 1000) % action.frameCount;
    this.draw();
  }
  currentAction() { return this.characters.get(this.characterId)?.actions[BUSINESS_STATES[this.state]]; }
  drawCharacter(ctx) {
    const character = this.characters.get(this.characterId);
    const action = this.currentAction();
    if (!character || !action) return;
    const [cw, ch] = action.frameSize;
    const [ax, ay] = character.poseAnchor;
    const [sx, sy] = this.station.seatAnchor;
    const x = sx - ax * character.scale, y = sy - ay * character.scale;
    ctx.drawImage(action.image, (this.frame % action.grid[0]) * cw, Math.floor(this.frame / action.grid[0]) * ch,
      cw, ch, x, y, cw * character.scale, ch * character.scale);
  }
  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;
    if (!this.back || !this.front) return;
    // Furniture positions never depend on actor identity, frame, state, scale or pose anchor.
    if (this.view !== 'character') ctx.drawImage(this.back, 0, 0);
    if (this.view !== 'workstation') this.drawCharacter(ctx);
    if (this.view !== 'character') ctx.drawImage(this.front, 0, 0);
    // Small fixed input-surface windows let connected actor paws appear above the keys.
    // This is an occlusion rule shared by all characters, not a per-frame repair/mask.
    if (this.view === 'combined' && this.currentAction() && this.station.keyboardContactZones?.length) {
      ctx.save(); ctx.beginPath();
      for (const zone of this.station.keyboardContactZones) ctx.rect(...zone);
      ctx.clip(); this.drawCharacter(ctx); ctx.restore();
    }
    if (this.guides) {
      const [x, y] = this.station.seatAnchor;
      ctx.strokeStyle = '#d64789'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x-7,y); ctx.lineTo(x+7,y); ctx.moveTo(x,y-7); ctx.lineTo(x,y+7); ctx.stroke();
      ctx.strokeStyle = '#21acaa';
      for (const rect of this.station.keyboardContactZones ?? []) ctx.strokeRect(...rect);
    }
  }
  snapshot() {
    const action = this.currentAction();
    return {state:this.state, action:BUSINESS_STATES[this.state], characterId:this.characterId,
      available:Boolean(action), frame:this.frame, frameCount:action?.frameCount??0, fps:action?.fps??0,
      workstationId:this.station.id, seatAnchor:[...this.station.seatAnchor], view:this.view};
  }
}

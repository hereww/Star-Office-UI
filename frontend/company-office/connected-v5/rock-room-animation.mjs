const DEFAULT_FRAME_SIZE = Object.freeze([96, 96]);
const DEFAULT_GRID = Object.freeze([4, 3]);
// Rock-room pacing is intentionally relaxed. Office actors and screen overlays
// keep their existing 12fps clocks; this is the room-only contract.
const DEFAULT_FPS = 8;
const DEFAULT_FRAME_COUNT = 12;
const ROCK_ROOM_ID = 'rock';

function pair(value, name) {
  if (!Array.isArray(value) || value.length !== 2 || value.some((item) => !Number.isFinite(item))) {
    throw new Error(`摇滚房间动画 ${name} 无效`);
  }
}

function rect(value, name) {
  if (!Array.isArray(value) || value.length !== 4 || value.some((item) => !Number.isFinite(item) || item < 0)) {
    throw new Error(`摇滚房间动画 ${name} 无效`);
  }
}

function contains(outer, inner) {
  return (
    inner[0] >= outer[0] &&
    inner[1] >= outer[1] &&
    inner[0] + inner[2] <= outer[0] + outer[2] &&
    inner[1] + inner[3] <= outer[1] + outer[3]
  );
}

function equalPair(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);
}

function equalRect(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);
}

function alphaFrameBounds(frameSize, scale, anchor) {
  return [
    anchor[0] - frameSize[0] * scale / 2,
    anchor[1] - frameSize[1] * scale,
    frameSize[0] * scale,
    frameSize[1] * scale,
  ];
}

function assetKey(id) {
  return `company-office-rock-room-${id}`;
}

function occlusionKey(id) {
  return `company-office-rock-room-occlusion-${id}`;
}

function validateTransparentSheet(source, contract, id) {
  if (!contract.transparent) return;
  const canvas = globalThis.document?.createElement?.('canvas');
  const context = canvas?.getContext?.('2d', {willReadFrequently: true});
  if (!canvas || !context) throw new Error(`摇滚房间素材无法验证透明背景: ${id}`);
  canvas.width = source.width;
  canvas.height = source.height;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let row = 0; row < contract.grid[1]; row += 1) {
    for (let column = 0; column < contract.grid[0]; column += 1) {
      let transparent = false;
      let visible = false;
      for (let y = row * contract.frameSize[1]; y < (row + 1) * contract.frameSize[1]; y += 1) {
        for (let x = column * contract.frameSize[0]; x < (column + 1) * contract.frameSize[0]; x += 1) {
          const alpha = pixels[(y * canvas.width + x) * 4 + 3];
          transparent ||= alpha === 0;
          visible ||= alpha > 0;
          if (transparent && visible) break;
        }
        if (transparent && visible) break;
      }
      if (!transparent || !visible) {
        canvas.width = 0;
        canvas.height = 0;
        throw new Error(`摇滚房间素材透明背景无效: ${id} frame=${row * contract.grid[0] + column}`);
      }
    }
  }
  canvas.width = 0;
  canvas.height = 0;
}

function validateTransparentImage(source, id) {
  const canvas = globalThis.document?.createElement?.('canvas');
  const context = canvas?.getContext?.('2d', {willReadFrequently: true});
  if (!canvas || !context) throw new Error(`摇滚房间遮挡层无法验证透明背景: ${id}`);
  canvas.width = source.width;
  canvas.height = source.height;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let transparent = false;
  let visible = false;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    transparent ||= pixels[offset] === 0;
    visible ||= pixels[offset] > 0;
    if (transparent && visible) break;
  }
  canvas.width = 0;
  canvas.height = 0;
  if (!transparent || !visible) throw new Error(`摇滚房间遮挡层透明背景无效: ${id}`);
}

export function validateRockRoomAnimation(layout, assets) {
  const room = (layout.rooms ?? []).find((item) => item.id === ROCK_ROOM_ID);
  const spec = layout.roomAnimations?.rock;
  const contract = assets.roomAnimationContract;
  if (!room || !spec || !contract) throw new Error('connected-v5 缺少摇滚房间动画配置');
  rect(room.bounds, '房间 bounds');
  rect(spec.bounds, 'bounds');
  if (!equalRect(room.bounds, spec.bounds)) throw new Error('摇滚房间动画 bounds 必须与房间 bounds 一致');
  if (contract.schemaVersion !== 1) throw new Error('摇滚房间动画契约版本不支持');
  if (!equalPair(contract.frameSize, DEFAULT_FRAME_SIZE)) throw new Error('摇滚房间动画必须使用96x96帧');
  if (!equalPair(contract.grid, DEFAULT_GRID)) throw new Error('摇滚房间动画必须使用4x3网格');
  if (contract.frameCount !== DEFAULT_FRAME_COUNT || contract.fps !== DEFAULT_FPS) throw new Error('摇滚房间动画必须为12帧8fps');
  if (contract.transparent !== true || contract.loop !== true || contract.audio !== false) throw new Error('摇滚房间动画契约不满足透明循环视觉-only要求');
  if (!Array.isArray(spec.performers) || spec.performers.length !== 4) throw new Error('摇滚房间必须配置4只猫');

  const ids = new Set();
  const assetsById = new Set();
  for (const performer of spec.performers) {
    if (!performer || typeof performer.id !== 'string' || ids.has(performer.id)) throw new Error('摇滚房间角色 ID 重复或无效');
    if (typeof performer.role !== 'string' || typeof performer.asset !== 'string') throw new Error(`摇滚房间角色 ${performer.id} 缺少角色或素材`);
    pair(performer.anchor, `${performer.id}.anchor`);
    if (!(performer.scale > 0 && performer.scale <= 2)) throw new Error(`摇滚房间角色 ${performer.id} scale 无效`);
    if (!Number.isFinite(performer.depth) || !Number.isFinite(performer.phase)) throw new Error(`摇滚房间角色 ${performer.id} depth/phase 无效`);
    const frameBounds = alphaFrameBounds(contract.frameSize, performer.scale, performer.anchor);
    if (!contains(room.bounds, frameBounds)) throw new Error(`摇滚房间角色 ${performer.id} 的显示范围越出房间`);
    ids.add(performer.id);
    assetsById.add(performer.asset);
  }
  if (assetsById.size !== spec.performers.length) throw new Error('摇滚房间角色必须使用4套独立素材');

  if (!Array.isArray(spec.occlusionLayers) || spec.occlusionLayers.length < 1) {
    throw new Error('摇滚房间必须配置至少一层乐器前景遮挡');
  }
  const occlusionIds = new Set();
  for (const layer of spec.occlusionLayers) {
    if (!layer || typeof layer.id !== 'string' || occlusionIds.has(layer.id)) throw new Error('摇滚房间遮挡层 ID 重复或无效');
    if (typeof layer.asset !== 'string') throw new Error(`摇滚房间遮挡层 ${layer.id} 缺少素材`);
    if (!Number.isFinite(layer.depth)) throw new Error(`摇滚房间遮挡层 ${layer.id} depth 无效`);
    occlusionIds.add(layer.id);
  }

  const effects = spec.effects ?? {};
  if (effects.enabled !== false) {
    if (!Array.isArray(effects.points)) throw new Error('摇滚房间灯光 points 无效');
    for (const point of effects.points) pair(point, 'effects.point');
  }
  if (spec.labelAnchor) {
    pair(spec.labelAnchor, 'labelAnchor');
    if (!contains(room.bounds, [spec.labelAnchor[0], spec.labelAnchor[1], 0, 0])) throw new Error('摇滚房间标签锚点越出房间');
  }
  return spec;
}

export class RockRoomAnimation {
  constructor(layout, assets, baseUrl) {
    this.layout = structuredClone(layout);
    this.assets = structuredClone(assets);
    this.baseUrl = baseUrl;
    this.spec = validateRockRoomAnimation(this.layout, this.assets);
    this.contract = this.assets.roomAnimationContract;
    this.frame = 0;
    this.lastTick = -1;
    this.ready = false;
    this.reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.performers = [];
    this.occlusionLayers = [];
    this.visibility = { enabled: true, performers: {} };
    this.effectLayer = null;
    this.scene = null;
  }

  preload(scene) {
    for (const performer of this.spec.performers) {
      const key = assetKey(performer.id);
      const url = new URL(performer.asset, this.baseUrl).href;
      scene.load.spritesheet(key, url, {
        frameWidth: this.contract.frameSize[0],
        frameHeight: this.contract.frameSize[1],
      });
    }
    for (const layer of this.spec.occlusionLayers) {
      const key = occlusionKey(layer.id);
      const url = new URL(layer.asset, this.baseUrl).href;
      scene.load.image(key, url);
    }
  }

  create(scene) {
    this.scene = scene;
    this.performers = this.spec.performers.map((spec) => {
      const key = assetKey(spec.id);
      const texture = scene.textures.get(key);
      const source = texture?.getSourceImage?.();
      // Phaser keeps a synthetic base frame in frameTotal for spritesheets.
      const frameCount = Math.max(0, (texture?.frameTotal ?? 0) - 1);
      if (!source || source.width !== this.contract.frameSize[0] * this.contract.grid[0] || source.height !== this.contract.frameSize[1] * this.contract.grid[1]) {
        throw new Error(`摇滚房间素材尺寸不符: ${spec.id}`);
      }
      if (frameCount !== this.contract.frameCount) throw new Error(`摇滚房间素材帧数不符: ${spec.id}`);
      validateTransparentSheet(source, this.contract, spec.id);
      const sprite = scene.add.sprite(spec.anchor[0], spec.anchor[1], key, 0)
        .setOrigin(0.5, 1)
        .setScale(spec.scale)
        .setDepth(spec.depth);
      sprite.setData('companyOfficeLocked', true);
      return { ...spec, key, sprite };
    });

    this.occlusionLayers = this.spec.occlusionLayers.map((spec) => {
      const key = occlusionKey(spec.id);
      const texture = scene.textures.get(key);
      const source = texture?.getSourceImage?.();
      const [x, y, width, height] = this.spec.bounds;
      if (!source || source.width !== width || source.height !== height) {
        throw new Error(`摇滚房间遮挡层尺寸不符: ${spec.id}`);
      }
      validateTransparentImage(source, spec.id);
      const image = scene.add.image(x, y, key)
        .setOrigin(0, 0)
        .setDepth(spec.depth);
      image.setData('companyOfficeLocked', true);
      return {...spec, key, image};
    });

    const effects = this.spec.effects ?? {};
    this.effectLayer = scene.add.graphics().setDepth(effects.depth ?? 760);
    this.effectLayer.setData('companyOfficeLocked', true);
    this.ready = true;
    this.applyVisibility({ rock: this.visibility });

    this.motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.motionHandler = (event) => {
      this.reducedMotion = event.matches;
      this.lastTick = -1;
      this.sample(this.scene?.time.now ?? 0);
    };
    this.motionQuery?.addEventListener('change', this.motionHandler);
    scene.events.once('shutdown', () => this.destroy());
    this.sample(scene.time.now);
    return this;
  }

  /** Apply server-owned visibility without changing the fixed performer geometry. */
  applyVisibility(settings) {
    const room = settings?.rock;
    const enabled = room?.enabled !== false;
    const performerSettings = room?.performers && typeof room.performers === 'object' ? room.performers : {};
    this.visibility = {
      enabled,
      performers: Object.fromEntries(this.spec.performers.map((performer) => [performer.id, performerSettings[performer.id] !== false])),
    };
    for (const performer of this.performers) {
      performer.visible = enabled && this.visibility.performers[performer.id] === true;
      performer.sprite?.setVisible(performer.visible);
    }
    this.effectLayer?.setVisible(enabled);
    this.lastTick = -1;
    if (!enabled) {
      // A hidden room is an empty stage: clear the pulse layer and stop
      // advancing the band clock until the server turns it back on.
      this.effectLayer?.clear();
      return;
    }
    if (this.ready) this.sample(this.scene?.time.now ?? 0);
  }

  sample(time) {
    if (!this.ready) return;
    if (!this.visibility.enabled) return;
    const tick = this.reducedMotion ? 0 : Math.floor(Math.max(0, time) * this.contract.fps / 1000);
    const frame = tick % this.contract.frameCount;
    if (tick === this.lastTick && !this.reducedMotion) return;
    this.lastTick = tick;
    this.frame = frame;
    for (const performer of this.performers) {
      const localFrame = (frame + performer.phase) % this.contract.frameCount;
      // Every atlas cell is pre-aligned to the same foot line. Keep this
      // world anchor fixed; the hands, ears, tail and face move inside the
      // cell so the performer never slides through an instrument.
      if (Number(performer.sprite.frame?.name) !== localFrame) performer.sprite.setFrame(localFrame);
    }
    this.drawEffects(frame);
  }

  drawEffects(frame) {
    if (!this.effectLayer) return;
    const effects = this.spec.effects ?? {};
    this.effectLayer.clear();
    if (this.reducedMotion || effects.enabled === false) return;
    const points = effects.points ?? [];
    const palette = effects.palette ?? [0xffd36e, 0xe77b64];
    for (let index = 0; index < points.length; index += 1) {
      const [x, y] = points[index];
      const pulse = (frame + index * 3) % this.contract.frameCount;
      const alpha = pulse < 4 ? 0.28 : pulse < 8 ? 0.12 : 0.04;
      const color = palette[index % palette.length];
      this.effectLayer.fillStyle(color, alpha);
      this.effectLayer.fillRect(Math.round(x), Math.round(y), 3, 3);
    }
  }

  update(time) {
    this.sample(time);
  }

  snapshot() {
    const roomVisible = this.ready && this.visibility.enabled;
    const visiblePerformers = this.performers.filter((performer) => performer.visible === true);
    return {
      enabled: roomVisible,
      loaded: this.ready,
      roomVisible,
      playing: roomVisible && !this.reducedMotion,
      room: ROCK_ROOM_ID,
      anchorMode: 'fixed-world-anchor',
      frame: this.frame,
      frameCount: this.contract.frameCount,
      fps: this.contract.fps,
      performerCount: this.performers.length,
      visiblePerformerCount: visiblePerformers.length,
      performerIds: this.performers.map((performer) => performer.id),
      visiblePerformerIds: visiblePerformers.map((performer) => performer.id),
      performers: this.performers.map((performer) => ({ id: performer.id, role: performer.role, visible: performer.visible === true })),
      occlusionLayerCount: this.occlusionLayers.length,
      occlusionLayerIds: this.occlusionLayers.map((layer) => layer.id),
      reducedMotion: this.reducedMotion,
      audio: false,
      walking: false,
      bounds: [...this.spec.bounds],
    };
  }

  destroy() {
    this.motionQuery?.removeEventListener('change', this.motionHandler);
    this.motionQuery = null;
    this.motionHandler = null;
    this.effectLayer?.destroy();
    this.effectLayer = null;
    const textures = this.scene?.textures;
    for (const performer of this.performers) {
      performer.sprite?.destroy();
      if (textures?.exists?.(performer.key)) textures.remove(performer.key);
    }
    for (const layer of this.occlusionLayers) {
      layer.image?.destroy();
      if (textures?.exists?.(layer.key)) textures.remove(layer.key);
    }
    this.performers = [];
    this.occlusionLayers = [];
    this.scene = null;
    this.ready = false;
  }
}

export { DEFAULT_FRAME_COUNT, DEFAULT_FRAME_SIZE, DEFAULT_FPS, DEFAULT_GRID, ROCK_ROOM_ID };

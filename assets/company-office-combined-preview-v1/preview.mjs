import { SeatedOfficePlayer, BUSINESS_STATES, loadImage } from '/source/seated-compositor.mjs';
import { OfficeNavigator, moveAlong, directionBetween, DIRECTIONS } from './navigation.mjs';

const $ = id => document.getElementById(id);
const STATE_NAMES = { idle: '休息 · 仰脸熟睡', writing: '工作 · 专注表情', researching: '搜索 · 专注表情', executing: '执行 · 专注表情', syncing: '同步 · 耐心等待', error: '异常 · 旋涡眼' };
const DIR_NAMES = { up: '向上', down: '向下', left: '向左', right: '向右' };
async function readJson(url) { const response = await fetch(url); if (!response.ok) throw new Error(`素材读取失败：${response.status} ${url}`); return response.json(); }
function canvasFor(w, h) { const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; return canvas; }
function stationName(station) { return station.kind === 'private' ? ({ 'private-finance': '财务室工位', 'private-manager': '总经理工位', 'private-supervisor': '主管工位' })[station.id] : `工位 ${station.id.slice(-2)}`; }

class CombinedPreview {
  async initialize() {
    this.config = await readJson('/scene.json');
    [this.layout, this.office] = await Promise.all([readJson(this.config.map), readJson(this.config.office)]);
    if (this.layout.directionRule !== 'cardinal-only' || this.layout.stations.length !== 36) throw new Error('地图契约不匹配');
    this.background = await loadImage(`/source/${this.layout.background}`);
    if (this.background.width !== this.layout.size[0] || this.background.height !== this.layout.size[1]) throw new Error('背景尺寸与布局不符');
    this.player = await new SeatedOfficePlayer(canvasFor(192, 192), this.office, { baseUrl: new URL('/source/', location.href).href }).initialize();
    this.player.view = 'character'; this.player.setState('writing');
    this.walkImages = Object.fromEntries(await Promise.all(DIRECTIONS.map(async direction => {
      const images = await Promise.all(['A', 'B'].map(phase => loadImage(`${this.config.walking.assetRoot}${direction}/${phase}.png`)));
      if (images.some(image => image.width !== 96 || image.height !== 96)) throw new Error(`行走图尺寸不符：${direction}`);
      return [direction, images];
    })));
    this.nav = new OfficeNavigator(this.layout, this.config.obstacles, { radius: this.config.walking.footRadius });
    this.home = this.layout.stations.find(station => station.id === this.layout.mainStation);
    this.actor = { position: this.nav.dock(this.home), mode: 'seated', seat: this.home.id, direction: 'down', path: [], target: null, distance: 0, pose: 0 };
    if (!this.actor.position) throw new Error('主工位入口不可达');
    this.time = 0; this.stateEpoch = 0; this.state = 'writing'; this.lastTick = -1; this.paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.auto = false; this.autoIndex = 0; this.autoHold = 0; this.walkScale = this.config.walking.scale; this.view = 'follow';
    this.camera = { x: this.home.center[0], y: this.home.center[1] - 50, zoom: 1, custom: false };
    this.world = $('world'); this.ctx = this.world.getContext('2d'); this.detail = $('detail'); this.detailCtx = this.detail.getContext('2d'); this.mini = $('minimap'); this.miniCtx = this.mini.getContext('2d');
    this.trace = []; this.violations = 0; this.roundTrips = 0; this.activeSeconds = 0; this.toastUntil = 0; this.lastUiTime = -1000;
    this.walls = this.layout.walls.map(wall => {
      const [x1, y1, x2, y2] = wall, p = 19;
      return { bounds: [Math.min(x1, x2) - p, Math.min(y1, y2) - p, Math.abs(x2 - x1) + p * 2, Math.abs(y2 - y1) + p * 2], horizontal: y1 === y2, depth: y1 + 20 };
    });
    this.bindControls(); this.resize(); this.geometricAudit(); this.ready = true;
    $('loading').hidden = true; this.updateUi(true); this.draw();
    this.clockPrevious = performance.now(); requestAnimationFrame(time => this.loop(time));
  }
  geometricAudit() {
    const start = this.nav.dock(this.home), failures = [];
    for (const station of this.layout.stations) {
      const dock = this.nav.dock(station), path = dock && this.nav.route(start, dock), reverse = dock && this.nav.route(dock, start);
      if (!path || !reverse || path.some((point, i) => i && !this.nav.segmentClear(path[i - 1], point))) failures.push(station.id);
    }
    this.geometry = { testedStations: 36, reachableStations: 36 - failures.length, roundTrips: (36 - failures.length) * 2, failed: failures };
    $('geometry-result').textContent = failures.length ? `注意：${failures.join('、')} 不可达` : '36 / 36 工位双向可达 · 四向路径通过连续脚底碰撞检查';
    if (failures.length) throw new Error(`工位不可达：${failures.join(',')}`);
  }
  bindControls() {
    $('follow').onclick = () => this.setView('follow'); $('overview').onclick = () => this.setView('overview');
    $('center').onclick = () => this.setView('follow');
    $('zoom-in').onclick = () => this.zoomAt(1.25); $('zoom-out').onclick = () => this.zoomAt(.8);
    $('home').onclick = () => { this.setAuto(false); this.goStation(this.home.id); };
    $('pause').onclick = () => { this.paused = !this.paused; this.updateUi(true); };
    $('auto').onclick = () => { this.setAuto(!this.auto); if (this.auto) { this.paused = false; this.setView('follow'); } this.updateUi(true); };
    $('walk-scale').oninput = event => { this.walkScale = Number(event.target.value); $('walk-scale-label').textContent = `${this.walkScale.toFixed(2)}×`; this.draw(); this.updateUi(true); };
    $('step').onclick = () => { this.paused = true; this.advance(1000); this.draw(); this.updateUi(true); };
    $('next-frame').onclick = () => {
      this.paused = true;
      if (this.actor.mode !== 'seated') { this.notice('表情逐帧只适用于工位坐姿；请先回工位。'); return; }
      this.player.setFrame((this.player.faceFrame + 1) % 12); this.draw(); this.updateUi(true);
    };
    $('geometry').onchange = () => this.draw(); $('show-route').onchange = () => this.draw();
    for (const button of document.querySelectorAll('[data-state]')) button.onclick = () => {
      this.setAuto(false); this.setState(button.dataset.state);
      if (this.actor.mode !== 'seated') this.goStation(this.actor.seat);
      this.updateUi(true); this.draw();
    };
    for (const destination of this.config.destinations) {
      const button = document.createElement('button'); button.textContent = destination.label; button.dataset.destination = destination.id;
      button.onclick = () => { this.setAuto(false); destination.station ? this.goStation(destination.station) : this.goPoint(destination.point, destination.label.replace('去', '')); this.updateUi(true); };
      $('destinations').append(button);
    }
    this.world.addEventListener('wheel', event => {
      event.preventDefault(); const rect = this.world.getBoundingClientRect(); this.zoomAt(Math.exp(-event.deltaY * .0015), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    this.world.addEventListener('pointerdown', event => {
      if (event.button && event.pointerType === 'mouse') return;
      this.world.setPointerCapture(event.pointerId);
      this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, cameraX: this.camera.x, cameraY: this.camera.y, moved: false };
    });
    this.world.addEventListener('pointermove', event => {
      if (!this.drag || this.drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
      if (Math.hypot(dx, dy) > 6) this.drag.moved = true;
      if (this.drag.moved) { this.camera.custom = true; this.camera.x = this.drag.cameraX - dx / this.camera.zoom; this.camera.y = this.drag.cameraY - dy / this.camera.zoom; this.clampCamera(); this.world.style.cursor = 'grabbing'; this.draw(); }
    });
    this.world.addEventListener('pointerup', event => {
      if (!this.drag || this.drag.pointerId !== event.pointerId) return;
      const moved = this.drag.moved; this.drag = null; this.world.style.cursor = 'crosshair';
      if (!moved) { const rect = this.world.getBoundingClientRect(); this.selectWorld(this.toWorld(event.clientX - rect.left, event.clientY - rect.top)); }
    });
    this.world.addEventListener('pointercancel', () => { this.drag = null; this.world.style.cursor = 'crosshair'; });
    this.world.addEventListener('keydown', event => {
      const offsets = { ArrowUp: [0, -112], ArrowDown: [0, 112], ArrowLeft: [-112, 0], ArrowRight: [112, 0] };
      if (!offsets[event.key]) return;
      event.preventDefault(); this.setAuto(false); const delta = offsets[event.key]; this.goPoint([this.actor.position[0] + delta[0], this.actor.position[1] + delta[1]], '键盘移动');
    });
    this.mini.onclick = event => {
      const rect = this.mini.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width * this.mini.width, y = (event.clientY - rect.top) / rect.height * this.mini.height;
      this.selectWorld([(x - this.miniOffset[0]) / this.miniZoom, (y - this.miniOffset[1]) / this.miniZoom]);
    };
    new ResizeObserver(() => this.resize()).observe($('map-stage'));
  }
  selectWorld(point) {
    this.setAuto(false);
    const station = this.layout.stations.find(station => Math.abs(station.center[0] - point[0]) <= 90 && Math.abs(station.center[1] - point[1]) <= 87);
    if (station) this.goStation(station.id); else this.goPoint(point, '选定地面');
    this.updateUi(true); this.draw();
  }
  setState(state) {
    if (!Object.hasOwn(BUSINESS_STATES, state)) throw new Error('未知业务状态');
    this.state = state; this.stateEpoch = this.time; this.lastTick = -1; this.player.setState(state);
  }
  setAuto(value) {
    this.auto = value;
    if (value) { this.autoIndex = 0; this.autoHold = 0; this.setState('writing'); }
    this.updateUi(true);
  }
  goStation(id) {
    const station = this.layout.stations.find(station => station.id === id), dock = station && this.nav.dock(station);
    if (!dock) { this.notice('这个工位暂时没有可通行的入口。'); return false; }
    return this.go(dock, { station: id, label: stationName(station) });
  }
  goPoint(point, label) {
    if (!this.nav.isWalkable(point)) { this.notice('这里是墙体、家具或地图外侧，请点击通道。'); return false; }
    const goal = this.nav.nearest(point, 24);
    if (!goal) { this.notice('目的地太窄，请选择通道中间。'); return false; }
    return this.go(goal, { station: null, label });
  }
  go(goal, target) {
    const path = this.nav.route(this.actor.position, goal);
    if (!path) { this.notice('没有安全的四向路线，已保留当前位置。'); return false; }
    if (this.actor.mode === 'seated') this.actor.position = this.nav.dock(this.layout.stations.find(station => station.id === this.actor.seat));
    this.actor.path = path.slice(1); this.actor.target = { ...target, point: path.at(-1) };
    this.actor.mode = this.actor.path.length ? 'walking' : 'standing'; this.actor.pose = 0;
    if (this.actor.path.length) this.actor.direction = directionBetween(this.actor.position, this.actor.path[0]) ?? this.actor.direction;
    this.trace = []; this.activeSeconds = 0;
    if (!this.actor.path.length) this.arrive();
    this.updateUi(true); return true;
  }
  arrive() {
    const target = this.actor.target;
    if (!target) return;
    if (target.station) { this.actor.seat = target.station; this.actor.mode = 'seated'; this.stateEpoch = this.time; this.lastTick = -1; this.player.setState(this.state); }
    else this.actor.mode = 'standing';
    this.actor.pose = 0; this.roundTrips++; this.autoHold = 0;
  }
  advance(ms) {
    this.time += ms;
    if (this.actor.mode === 'walking') {
      const before = [...this.actor.position];
      const result = moveAlong(this.actor.position, this.actor.path, this.config.walking.speed * ms / 1000);
      // Validate every actually consumed segment, including turns inside large deterministic QA steps.
      let cursor = before, budget = result.traveled;
      for (const destination of this.actor.path) {
        if (budget <= 0) break;
        const segment = moveAlong(cursor, [destination], budget), next = segment.position;
        if (!this.nav.segmentClear(cursor, next)) this.violations++;
        if (this.trace.length < 3000 && segment.traveled) this.trace.push({ from: cursor, to: next, direction: segment.direction });
        budget -= segment.traveled; cursor = next;
      }
      Object.assign(this.actor, { position: result.position, path: result.path });
      if (result.direction) this.actor.direction = result.direction;
      this.actor.distance += result.traveled; this.actor.pose = Math.floor(this.actor.distance / this.config.walking.stridePixelsPerPose) % 2;
      if (!this.actor.path.length) this.arrive();
    }
    const tick = Math.floor((this.time - this.stateEpoch) * 12 / 1000);
    if (tick !== this.lastTick) { this.lastTick = tick; this.player.sample(this.time - this.stateEpoch); }
    if (this.auto && this.actor.mode !== 'walking') {
      this.autoHold += ms;
      const sequence = [
        { hold: 4000, state: 'writing', destination: { point: [928, 1248], label: '茶水区' } },
        { hold: 1300, destination: { point: [928, 2288], label: '门厅' } },
        { hold: 1300, destination: { station: 'desk-15' } },
        { hold: 3000, state: 'syncing', destination: { station: this.home.id } },
        { hold: 4000, state: 'idle' }, { hold: 4000, state: 'error' }, { hold: 3000, state: 'writing' }
      ];
      const stage = sequence[this.autoIndex];
      if (this.autoHold >= stage.hold) {
        if (stage.state) this.setState(stage.state);
        if (stage.destination) stage.destination.station ? this.goStation(stage.destination.station) : this.goPoint(stage.destination.point, stage.destination.label);
        this.autoIndex = (this.autoIndex + 1) % sequence.length; this.autoHold = 0;
      }
    }
    this.activeSeconds += ms / 1000;
  }
  loop(now) {
    const dt = Math.min(50, Math.max(0, now - this.clockPrevious)); this.clockPrevious = now;
    if (!this.paused && !document.hidden) this.advance(dt);
    if (this.view === 'follow' && !this.camera.custom && !this.drag) {
      const focus = this.focus(); this.camera.x += (focus[0] - this.camera.x) * .16; this.camera.y += (focus[1] - this.camera.y) * .16;
    }
    this.draw(); if (now - this.lastUiTime > 160) { this.updateUi(); this.lastUiTime = now; }
    if (this.toastUntil && now > this.toastUntil) { $('toast').hidden = true; this.toastUntil = 0; }
    requestAnimationFrame(time => this.loop(time));
  }
  focus() {
    if (this.actor.mode === 'seated') { const station = this.layout.stations.find(station => station.id === this.actor.seat); return [station.center[0], station.center[1] - 50]; }
    return [this.actor.position[0], this.actor.position[1] - 75];
  }
  resize() {
    const rect = this.world.getBoundingClientRect(); this.width = rect.width; this.height = rect.height;
    const dpr = Math.min(2, devicePixelRatio || 1); this.dpr = dpr; this.world.width = Math.round(rect.width * dpr); this.world.height = Math.round(rect.height * dpr);
    if (!this.camera.custom) this.setView(this.view, false); this.draw();
  }
  setView(view, instant = true) {
    this.view = view; this.camera.custom = false;
    const focus = view === 'overview' ? [1052, 1436] : this.focus(), span = view === 'overview' ? [1848, 2648] : [960, 760];
    this.camera.zoom = Math.min(this.width / span[0], this.height / span[1]);
    if (instant || view === 'overview') [this.camera.x, this.camera.y] = focus;
    this.updateUi(true); this.draw();
  }
  clampCamera() { this.camera.x = Math.max(0, Math.min(this.layout.size[0], this.camera.x)); this.camera.y = Math.max(0, Math.min(this.layout.size[1], this.camera.y)); }
  zoomAt(factor, x = this.width / 2, y = this.height / 2) {
    const point = this.toWorld(x, y); this.camera.custom = true; this.camera.zoom = Math.max(.16, Math.min(3, this.camera.zoom * factor));
    this.camera.x = point[0] - (x - this.width / 2) / this.camera.zoom; this.camera.y = point[1] - (y - this.height / 2) / this.camera.zoom;
    this.clampCamera(); this.draw(); this.updateUi(true);
  }
  toWorld(x, y) { return [(x - this.width / 2) / this.camera.zoom + this.camera.x, (y - this.height / 2) / this.camera.zoom + this.camera.y]; }
  drawScene(ctx, { labels = true, route = true, diagnostics = false } = {}) {
    ctx.imageSmoothingEnabled = false; ctx.drawImage(this.background, 0, 0);
    const seat = this.layout.stations.find(station => station.id === this.actor.seat);
    ctx.strokeStyle = '#78967a'; ctx.lineWidth = 2; ctx.fillStyle = '#648b6530'; ctx.beginPath(); ctx.ellipse(seat.center[0], seat.center[1] + 77, 58, 9, 0, 0, Math.PI * 2); ctx.fill();
    if (route && $('show-route').checked && this.actor.mode === 'walking') {
      ctx.save(); ctx.strokeStyle = '#4f866bcc'; ctx.lineWidth = 3; ctx.setLineDash([10, 9]); ctx.beginPath(); ctx.moveTo(...this.actor.position); for (const point of this.actor.path) ctx.lineTo(...point); ctx.stroke(); ctx.restore();
      const target = this.actor.target.point; ctx.strokeStyle = '#b08a53'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(...target, 14, 6, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const items = this.layout.stations.map(station => ({ depth: station.center[1] + 74, render: () => {
      const [x, y] = station.center.map(v => v - 96); ctx.drawImage(this.player.images.back, x, y);
      if (this.actor.mode === 'seated' && station.id === this.actor.seat) ctx.drawImage(this.player.canvas, x, y);
      ctx.drawImage(this.player.images.front, x, y);
    } }));
    if (this.actor.mode !== 'seated') items.push({ depth: this.actor.position[1], render: () => this.drawWalking(ctx, this.actor.position, this.walkScale) });
    for (const wall of this.walls.filter(wall => wall.horizontal)) items.push({ depth: wall.depth, render: () => this.restoreWall(ctx, wall) });
    items.sort((a, b) => a.depth - b.depth); for (const item of items) item.render();
    // Vertical wall strips are foreground occluders; their doorway gaps remain untouched.
    for (const wall of this.walls.filter(wall => !wall.horizontal)) this.restoreWall(ctx, wall);
    if (labels) {
      ctx.textAlign = 'center'; ctx.font = `${Math.max(20, Math.min(48, 11 / this.camera.zoom))}px ArkPixel`; ctx.fillStyle = '#315e5b';
      for (const spec of [...this.layout.rooms, ...this.layout.zones]) ctx.fillText(spec.name, ...spec.label);
      ctx.font = '12px ArkPixel'; ctx.fillStyle = '#687a67';
      for (const station of this.layout.stations) if (station.kind === 'open') ctx.fillText(station.id.slice(-2), station.center[0], station.center[1] + 99);
      if (this.actor.mode === 'seated') { ctx.font = '15px ArkPixel'; ctx.fillStyle = '#fff6de'; ctx.fillRect(seat.center[0] - 72, seat.center[1] + 110, 144, 25); ctx.fillStyle = '#345d4d'; ctx.fillText(`阿橘 · ${STATE_NAMES[this.state].split(' · ')[0]}`, seat.center[0], seat.center[1] + 128); }
    }
    if (diagnostics) {
      ctx.lineWidth = 2; ctx.strokeStyle = '#c3704dcc'; ctx.fillStyle = '#c3704d24';
      for (const { bounds: [x, y, w, h] } of this.nav.obstacles) { ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); }
      ctx.strokeStyle = '#376baa'; ctx.beginPath(); ctx.arc(...this.actor.position, this.nav.radius, 0, Math.PI * 2); ctx.stroke();
    }
  }
  restoreWall(ctx, { bounds: [x, y, w, h] }) { ctx.drawImage(this.background, x, y, w, h, x, y, w, h); }
  drawWalking(ctx, point, scale) {
    const [x, y] = point, [ax, ay] = this.config.walking.footAnchor;
    ctx.fillStyle = '#3b4c3730'; ctx.beginPath(); ctx.ellipse(x, y + 2, 16 * scale, 4 * scale, 0, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(this.walkImages[this.actor.direction][this.actor.mode === 'walking' ? this.actor.pose : 0], x - ax * scale, y - ay * scale, 96 * scale, 96 * scale);
  }
  draw() {
    if (!this.background || !this.width) return;
    const ctx = this.ctx; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.width, this.height); ctx.fillStyle = '#d4e0d6'; ctx.fillRect(0, 0, this.width, this.height);
    ctx.translate(this.width / 2, this.height / 2); ctx.scale(this.camera.zoom, this.camera.zoom); ctx.translate(-this.camera.x, -this.camera.y);
    this.drawScene(ctx, { diagnostics: $('geometry').checked });
    const detail = this.detailCtx; detail.setTransform(1, 0, 0, 1, 0, 0); detail.clearRect(0, 0, 320, 224); detail.imageSmoothingEnabled = false;
    if (this.actor.mode === 'seated') { detail.drawImage(this.player.images.back, 64, 7); detail.drawImage(this.player.canvas, 64, 7); detail.drawImage(this.player.images.front, 64, 7); }
    else this.drawWalking(detail, [160, 195], this.walkScale * 1.3);
    this.miniZoom = Math.min(this.mini.width / 2048, this.mini.height / 2816); this.miniOffset = [(this.mini.width - 2048 * this.miniZoom) / 2, (this.mini.height - 2816 * this.miniZoom) / 2];
    const mini = this.miniCtx; mini.setTransform(1, 0, 0, 1, 0, 0); mini.clearRect(0, 0, this.mini.width, this.mini.height); mini.fillStyle = '#d4e0d6'; mini.fillRect(0, 0, this.mini.width, this.mini.height);
    mini.translate(...this.miniOffset); mini.scale(this.miniZoom, this.miniZoom); this.drawScene(mini, { labels: false, route: false });
    const focus = this.actor.mode === 'seated' ? seatPosition(this.layout, this.actor.seat) : this.actor.position;
    mini.fillStyle = '#c48743'; mini.beginPath(); mini.arc(...focus, 30, 0, Math.PI * 2); mini.fill(); mini.strokeStyle = '#fff9e9'; mini.lineWidth = 9; mini.stroke();
    mini.strokeStyle = '#3b6c59'; mini.lineWidth = 9; mini.strokeRect(this.camera.x - this.width / this.camera.zoom / 2, this.camera.y - this.height / this.camera.zoom / 2, this.width / this.camera.zoom, this.height / this.camera.zoom);
  }
  snapshot() {
    return { ready: this.ready, previewOnly: true, mapArtworkChanged: false, mapSize: this.layout.size, stations: this.layout.stations.length,
      businessState: this.state, mode: this.actor.mode, station: this.actor.seat, position: this.actor.position.map(v => Math.round(v * 100) / 100),
      direction: this.actor.direction, walkPose: this.actor.pose, walkFramesPerDirection: 2, full12FrameWalkAvailable: false, walkScale: this.walkScale,
      office: this.player.snapshot(), remainingPath: this.actor.path, target: this.actor.target, collisionViolations: this.violations,
      trace: this.trace.slice(-8), arrivals: this.roundTrips, auto: this.auto, autoIndex: this.autoIndex, paused: this.paused, view: this.view,
      camera: { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom, custom: this.camera.custom }, geometry: this.geometry };
  }
  updateUi(force = false) {
    if (!this.actor) return;
    $('pause').textContent = this.paused ? '继续播放' : '暂停'; $('pause').setAttribute('aria-pressed', String(this.paused));
    $('auto').textContent = this.auto ? '停止演示' : '自动演示'; $('auto').setAttribute('aria-pressed', String(this.auto));
    $('follow').setAttribute('aria-pressed', String(this.view === 'follow')); $('overview').setAttribute('aria-pressed', String(this.view === 'overview'));
    for (const button of document.querySelectorAll('[data-state]')) button.setAttribute('aria-pressed', String(button.dataset.state === this.state));
    const seated = this.actor.mode === 'seated', walking = this.actor.mode === 'walking';
    $('pose-badge').textContent = seated ? '固定工位' : walking ? '四向行走' : '通道站立';
    $('action-label').textContent = seated ? STATE_NAMES[this.state] : `${DIR_NAMES[this.actor.direction]} · ${walking ? '行走姿势预览' : '停步'}`;
    $('frame-label').textContent = seated ? `12 帧 / 12 fps · ${String(this.player.faceFrame + 1).padStart(2, '0')}` : `A/B 两姿势 · ${this.actor.pose ? 'B' : 'A'}`;
    const station = this.layout.stations.find(station => station.id === this.actor.seat);
    $('seat-label').textContent = seated ? stationName(station) : this.actor.target?.label ?? '通道';
    const activity = seated ? `阿橘在${stationName(station)} · ${STATE_NAMES[this.state].split(' · ')[0]}` : walking ? `阿橘${DIR_NAMES[this.actor.direction]}走向${this.actor.target?.label ?? '目的地'}` : `阿橘停在${this.actor.target?.label ?? '通道'}`;
    if ($('activity').textContent !== activity) $('activity').textContent = activity;
    $('camera-scale').textContent = `${Math.round(this.camera.zoom * 100)}%`;
    $('runtime-snapshot').textContent = JSON.stringify(this.snapshot(), null, 2);
    this.detail.dataset.mode = this.actor.mode; this.detail.dataset.state = this.state; this.detail.dataset.frame = String(seated ? this.player.faceFrame : this.actor.pose);
    this.world.dataset.ready = String(this.ready); this.world.dataset.mode = this.actor.mode;
  }
  notice(text) { $('toast').textContent = text; $('toast').hidden = false; this.toastUntil = performance.now() + 4000; }
}
function seatPosition(layout, id) { return layout.stations.find(station => station.id === id).center; }
const preview = new CombinedPreview();
preview.initialize().catch(error => { $('loading').hidden = false; $('loading').replaceChildren(); const title = document.createElement('strong'), message = document.createElement('p'); title.textContent = '预览加载失败'; message.textContent = error.message; $('loading').append(title, message); $('world').dataset.error = error.message; console.error(error); });

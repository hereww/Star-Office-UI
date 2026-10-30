import { createFullscreenHud } from './fullscreen-hud.mjs';
import { activeModelsLabel, activeModelsDescription } from './active-models.mjs';
import { el, button, formatTime, labelledValue, setNotice, fixtureBanner } from './dom.mjs';
import { initialSnapshot, publicSnapshot, failedSnapshot, statistics, usernameLabel, workCountLabel, workLabel, VIEWS } from './model.mjs';
import { pollSnapshot } from './transport.mjs';
import { toRuntimeSnapshot } from './codec.mjs';
import { createOfficeMap } from './map-loader.mjs';
/** Exactly one employee name/count line; aliases and technical seat IDs stay out. */
export function employeeIdentityHeading(station) {
  const bound = station?.bound === true;
  return el('h2', { 'data-testid': 'employee-display-name', 'data-activity': station?.status ?? 'unknown' },
    el('span', { 'data-testid': 'employee-username', 'data-identity-quality': station?.identityQuality ?? 'unavailable' }, bound ? usernameLabel(station) : '未绑定'),
    bound ? ['：', el('span', { 'data-testid': 'employee-work-count', 'data-concurrency-quality': station?.quality ?? 'unavailable' }, workCountLabel(station))] : null);
}
export async function mount(root, config, api) {
  let snapshot = initialSnapshot(), selected = 'desk-12', map = null, disposed = false, expanded = !matchMedia('(max-width: 900px)').matches, selectedByUser = false, appliedDisplay = false;
  const now = el('time', { class: 'sample-time', 'data-testid': 'last-sample' }, '尚无采样');
  const source = el('span', { class: 'connection', 'data-testid': 'source-status', role: 'status' }, '○ 等待连接');
  const notice = el('div', { class: 'notice', 'data-testid': 'employee-notice', role: 'status', hidden: true });
  const mapNotice = el('div', { class: 'map-loading', role: 'status' }, '正在载入已确认的 6.0.0 办公室场景（V5）…');
  const mapHost = el('div', { class: 'map-host', 'data-testid': 'office-map', tabindex: '-1', 'aria-label': '办公室地图：可拖动平移；缩放默认锁定，可通过缩放按钮解锁；使用视角按钮或工位列表操作' });
  const mapViewport = el('div', { class: 'map-viewport', 'data-testid': 'map-viewport' });
  const hud = createFullscreenHud();
  mapHost.append(mapViewport, hud.element);
  const detail = el('aside', { class: 'employee-detail', 'data-testid': 'seat-details', id: 'seat-detail', 'aria-label': '选中工位详情' });
  const detailToggle = button('收起详情', () => setExpanded(!expanded), { class: 'quiet-button', 'data-testid': 'details-toggle', 'aria-controls': 'seat-detail', 'aria-expanded': 'true' });
  const counts = el('div', { class: 'office-counts', 'aria-label': '办公室状态统计' });
  const viewButtons = VIEWS.map(([value, label]) => button(label, () => { map?.setView(value); for (const b of viewButtons) b.setAttribute('aria-pressed', String(b.dataset.view === value)); }, { class: 'view-button', 'data-testid': `view-${value}`, 'data-view': value, 'aria-pressed': String(value === 'overview') }));
  let zoomLocked = true;
  const mapHelp = el('p', { class: 'map-help', 'data-testid': 'map-help' });
  const zoomLockButton = button('', () => {
    zoomLocked = !zoomLocked;
    map?.setZoomLocked(zoomLocked);
    updateZoomLockUI();
  }, { class: 'view-button zoom-lock-button', 'data-testid': 'map-zoom-lock', 'aria-pressed': 'true' });
  const seats = el('div', { class: 'seat-strip', 'aria-label': '工位选择' });
  const mapShell = el('section', { class: 'map-shell', 'aria-label': '实时办公室' }, mapHost, mapNotice, el('div', { class: 'map-caption' }, el('span', {}, '6.0.0 · 连排工位（V5 场景）'), el('span', {}, '仅展示采样时刻状态')));
  const stage = el('main', { id: 'main-content', class: 'office-stage', tabindex: '-1' }, mapShell, detail);
  const fullScreen = button('⛶ 全屏', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await mapHost.requestFullscreen(); } catch { setNotice(notice, '此浏览器暂不支持全屏，可使用视角切换查看地图。'); } }, { class: 'quiet-button', 'data-testid': 'map-fullscreen', 'aria-label': '地图全屏', 'aria-pressed': 'false', title: '全屏地图与只读角色信息；按 Esc 退出全屏', disabled: true });
  const fullscreenChange = () => {
    const active = document.fullscreenElement === mapHost;
    fullScreen.setAttribute('aria-pressed', String(active));
    if (active) mapHost.focus({ preventScroll: true });
    else if (!disposed && !document.fullscreenElement) fullScreen.focus({ preventScroll: true });
  };
  const fullscreenKeydown = event => {
    // Embedded browsers can forward Esc to the page without exiting native
    // fullscreen. Keep a keyboard exit even though the map has no controls.
    if ((event.key === 'Escape' || event.key === 'Esc') && document.fullscreenElement === mapHost) {
      void document.exitFullscreen().catch(() => {});
    }
  };
  document.addEventListener('fullscreenchange', fullscreenChange);
  // Capture before Phaser/canvas handlers, but leave the browser's native
  // Escape action intact as a fallback when the embedded implementation
  // rejects document.exitFullscreen().
  document.addEventListener('keydown', fullscreenKeydown, true);
  function updateZoomLockUI() {
    zoomLockButton.textContent = zoomLocked ? '🔒 缩放已锁定' : '🔓 可缩放';
    zoomLockButton.setAttribute('aria-pressed', String(zoomLocked));
    zoomLockButton.setAttribute('aria-label', zoomLocked ? '解锁地图缩放' : '锁定地图缩放');
    zoomLockButton.title = zoomLocked ? '已锁定滚轮缩放；点击解锁后可放大或缩小地图' : '点击锁定地图缩放，防止滚轮误操作';
    mapHelp.textContent = zoomLocked ? '拖动平移 · 缩放已锁定 · 点击工位查看详情' : '拖动平移 · 滚轮缩放 · 点击工位查看详情';
  }
  updateZoomLockUI();
  root.replaceChildren(el('div', { class: 'employee-shell' },
    el('header', { class: 'office-header' }, el('div', { class: 'brand' }, el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '律'), el('div', {}, el('span', { class: 'eyebrow' }, 'STAR OFFICE / LIVE'), el('h1', {}, '律动实时办公室'))), el('div', { class: 'header-status' }, source, now)),
    el('div', { class: 'office-toolbar' }, counts, el('div', { class: 'toolbar-actions' }, detailToggle, fullScreen)),
    notice, stage, el('div', { class: 'office-bottom-bar' }, el('div', { class: 'map-controls' }, el('div', { class: 'view-switch', 'aria-label': '地图视角' }, viewButtons), zoomLockButton), mapHelp), seats,
    el('footer', { class: 'employee-footer' }, el('span', {}, '办公室每 2 秒读取本地快照；不推测请求内容。'), el('span', {}, '数据异常不代表员工空闲。'))));
  if (config.preview_fixture === true) root.prepend(fixtureBanner());
  function setExpanded(value) { expanded = value; stage.classList.toggle('detail-collapsed', !value); detail.hidden = !value; detailToggle.textContent = value ? '收起详情' : '展开详情'; detailToggle.setAttribute('aria-expanded', String(value)); }
  function focusSelected() {
    // A floating mobile drawer otherwise covers the camera-centered workstation.
    if (matchMedia('(max-width: 900px)').matches) { setExpanded(false); detailToggle.focus({ preventScroll: true }); }
    map?.selectStation(selected, { focus: true });
    for (const b of viewButtons) b.setAttribute('aria-pressed', String(b.dataset.view === 'workstation'));
  }
  function select(id, focus = false) { selected = id; selectedByUser = true; setExpanded(true); map?.selectStation(id, { focus }); renderDetail(); renderSeats(); hud.update(snapshot, selected); }
  function renderDetail() {
    const focusClass = detail.contains(document.activeElement) ? document.activeElement.className : null;
    const station = snapshot.stations.find(s => s.stationId === selected);
    const quality = !station?.bound ? '未绑定' : station.status === 'unknown' ? station.identityQuality === 'fresh' ? '部分未知' : '未知' : station.identityQuality === 'fresh' ? '可信' : '部分未知';
    detail.replaceChildren(el('div', { class: 'detail-top' }, el('span', { class: 'eyebrow' }, '详情'), button('×', () => { setExpanded(false); detailToggle.focus(); }, { class: 'icon-button', 'aria-label': '关闭工位详情' })),
      employeeIdentityHeading(station),
      el('dl', { class: 'details-data' },
        el('div', { class: 'data-pair' }, el('dt', {}, '当前模型'), el('dd', { 'data-testid': 'employee-models', 'data-quality': station?.activeModels?.quality ?? 'unavailable', title: activeModelsDescription(station) }, activeModelsLabel(station))),
        labelledValue('最近采样 · 北京时间', formatTime(snapshot.sampledAt)),
        el('div', { class: 'data-pair' }, el('dt', {}, '数据质量'), el('dd', { 'data-testid': 'employee-data-quality', 'data-identity-quality': station?.identityQuality ?? 'unavailable', 'data-concurrency-quality': station?.quality ?? 'unavailable' }, quality))),
      button('⌖ 聚焦这个工位', () => focusSelected(), { class: 'primary-button focus-seat', 'data-testid': 'focus-seat', disabled: !map }),
      el('p', { class: 'privacy-note' }, '全屏可查看今日用量；邮箱、Key 元数据及用量明细仅管理员可见。'));
    if (focusClass?.includes('focus-seat')) detail.querySelector('.focus-seat')?.focus(); else if (focusClass?.includes('icon-button')) detail.querySelector('.icon-button')?.focus();
  }
  const seatNodes = new Map();
  function renderSeats() {
    for (const station of snapshot.stations) {
      let node = seatNodes.get(station.stationId);
      if (!node) { node = button('', () => select(station.stationId), { class: 'seat-pill', 'data-testid': `seat-${station.stationId}`, 'data-seat-id': station.stationId }); seatNodes.set(station.stationId, node); seats.append(node); }
      node.textContent = station.bound ? usernameLabel(station) : '未绑定';
      node.classList.toggle('bound', station.bound); node.setAttribute('aria-pressed', String(station.stationId === selected));
      node.setAttribute('aria-label', workLabel(station));
    }
  }
  function render() {
    const stats = statistics(snapshot);
    counts.replaceChildren(...[['bound', '已绑定'], ['working', '处理中'], ['idle', '待命'], ['unknown', '未知']].map(([key, label]) => el('div', { class: `count ${key}`, 'data-testid': `stats-${key === 'working' ? 'busy' : key}` }, el('strong', {}, stats[key]), el('span', {}, label))));
    source.textContent = snapshot.sourceOK ? '● 采样正常' : '○ 状态未知'; source.dataset.ok = String(snapshot.sourceOK); now.textContent = formatTime(snapshot.sampledAt);
    setNotice(notice, snapshot.sourceOK ? '' : snapshot.reason);
    renderDetail(); renderSeats(); hud.update(snapshot, selected); map?.applyTelemetrySnapshot(toRuntimeSnapshot(snapshot));
    if (snapshot.display) { map?.applyDisplaySettings(snapshot.display); if (!selectedByUser && !appliedDisplay) { setExpanded(!snapshot.display.details_collapsed && !matchMedia('(max-width: 900px)').matches); map?.setView(snapshot.display.default_view); appliedDisplay = Boolean(map); } }
  }
  render(); setExpanded(expanded);
  const stopPolling = pollSnapshot(api, input => { snapshot = publicSnapshot(input); render(); }, () => { snapshot = failedSnapshot(snapshot); render(); });
  // Source can stay fresh while an earlier identity or concurrency observation expires.
  const staleTimer = setInterval(() => { const fresh = publicSnapshot(snapshot); if (JSON.stringify(fresh) !== JSON.stringify(snapshot)) { snapshot = fresh; render(); } }, 1_000);
  void createOfficeMap(mapViewport, config, { onSelect: id => { if (id === selected) return; selected = id; selectedByUser = true; setExpanded(true); renderDetail(); renderSeats(); hud.update(snapshot, selected); } }).then(handle => {
    if (disposed) { handle.dispose(); return; } map = handle; map.setZoomLocked(zoomLocked); map.applyTelemetrySnapshot(toRuntimeSnapshot(snapshot)); renderDetail();
    mapNotice.hidden = true; fullScreen.disabled = false;
    if (!handle.adapterReady) { mapNotice.hidden = false; mapNotice.classList.add('map-pending'); mapNotice.textContent = '6.0.0 地图已载入（V5 场景） · 等待遥测适配器接入（角色已隐藏）'; }
    render(); if (!selectedByUser && !snapshot.display) map.setView('overview');
  }).catch(() => { if (!disposed) { mapNotice.textContent = '地图暂时无法加载。请检查同源版本资源；工位列表仍可使用。'; mapNotice.classList.add('map-pending'); } });
  return () => { disposed = true; document.removeEventListener('fullscreenchange', fullscreenChange); document.removeEventListener('keydown', fullscreenKeydown, true); stopPolling(); clearInterval(staleTimer); map?.dispose(); };
}

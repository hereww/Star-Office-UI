/** Independent V3 sidebar. The runtime owns selection, cameras and live/demo state. */
const STATES = [
  ['idle', '待命'], ['writing', '写作'], ['researching', '研究'],
  ['executing', '执行'], ['syncing', '同步'], ['error', '异常'],
];
const DIRECTIONS = [
  ['down', '朝下（正面）'], ['up', '朝上（背面）'],
  ['left', '朝左'], ['right', '朝右'],
];
const VIEWS = [
  ['overview', '公司全图'], ['west', '红区'],
  ['east', '绿区'], ['workstation', '聚焦工位'],
];
const REGIONS = [
  { id: 'west', label: '红区', aliases: ['west', 'red'] },
  { id: 'east', label: '绿区', aliases: ['east', 'green'] },
];
const SOURCES = { live: '实际状态', demo: '演示状态', unbound: '未绑定' };
const stateNames = new Map(STATES);
const directionNames = new Map(DIRECTIONS);
const viewNames = new Map(VIEWS);
let mountNumber = 0;

function text(value, fallback = '') {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function errorText(error) {
  return error instanceof Error ? error.message : text(error, '未知错误');
}

function roleText(role) {
  const value = text(role);
  if (/^ai$/i.test(value)) return 'AI';
  if (['human', 'staff', 'employee', 'colleague'].includes(value)) return '同事';
  return value || '席位';
}

function sourceText(station) {
  return Object.hasOwn(SOURCES, station.source) ? SOURCES[station.source] : '未知来源';
}

function stateText(station) {
  if (station.source === 'unbound') return '未绑定';
  return stateNames.get(station.state) || '未知状态';
}

/**
 * Mount after office-runtime-ready. Load controls.css separately in the host page.
 * @param {object} runtime ReferenceOfficeRuntime, as documented in COMPANY_OFFICE_V3_DEVELOPMENT.md.
 * @param {{parent: HTMLElement}} options An independent sidebar container (not the map).
 * @returns {{destroy: () => void, refresh: () => boolean}}
 */
export function mountOfficeControls(runtime, { parent } = {}) {
  if (!parent || parent.nodeType !== 1 || typeof parent.append !== 'function') {
    throw new TypeError('mountOfficeControls 需要一个有效的 parent 容器。');
  }
  for (const method of ['snapshot', 'selectStation', 'setStationDirection', 'setStationState', 'setView', 'setDemoMode']) {
    if (!runtime || typeof runtime[method] !== 'function') {
      throw new TypeError(`办公室运行时缺少 ${method}()。`);
    }
  }

  const doc = parent.ownerDocument;
  const eventTarget = doc.defaultView;
  if (!eventTarget) throw new TypeError('parent 必须属于一个有效的浏览器文档。');
  const prefix = `ocv3-${++mountNumber}`;
  const listeners = [];
  const seatNodes = new Map();
  const stateButtons = new Map();
  const viewButtons = new Map();
  const regions = new Map();
  let destroyed = false;
  let snapshot = null;
  let pending = null;
  let lastSummary = '';

  function element(tag, className, content) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }
  function setText(node, content) {
    if (node.textContent !== content) node.textContent = content;
  }
  function listen(target, event, handler) {
    target.addEventListener(event, handler);
    listeners.push(() => target.removeEventListener(event, handler));
  }
  function button(label, className = '') {
    const node = element('button', `ocv3-button ${className}`.trim(), label);
    node.type = 'button';
    return node;
  }
  function section(title, key) {
    const node = element('section', 'ocv3-section');
    const heading = element('h3', 'ocv3-section-title', title);
    heading.id = `${prefix}-${key}`;
    node.setAttribute('aria-labelledby', heading.id);
    node.append(heading);
    root.append(node);
    return { node, heading };
  }

  const root = element('section', 'ocv3');
  root.setAttribute('aria-labelledby', `${prefix}-title`);
  root.setAttribute('role', 'region');
  root.tabIndex = 0;
  const header = element('header', 'ocv3-header');
  const title = element('h2', 'ocv3-title', '工位控制');
  title.id = `${prefix}-title`;
  const refreshButton = button('刷新', 'ocv3-refresh');
  refreshButton.setAttribute('aria-label', '重新读取办公室状态');
  header.append(title, refreshButton);
  const counts = element('p', 'ocv3-counts');
  const readiness = element('p', 'ocv3-hint');
  const modeLabel = element('p', 'ocv3-mode-label');
  const alert = element('p', 'ocv3-alert');
  alert.setAttribute('role', 'alert');
  alert.setAttribute('aria-atomic', 'true');
  alert.hidden = true;
  const status = element('p', 'ocv3-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  const unplacedNotice = element('p', 'ocv3-unplaced');
  unplacedNotice.hidden = true;
  root.append(header, counts, readiness, modeLabel, alert, status, unplacedNotice);

  const modeSection = section('实际 / 演示', 'mode');
  const modeActions = element('div', 'ocv3-mode-actions');
  const demoButton = button('进入演示模式', 'ocv3-demo');
  demoButton.setAttribute('aria-pressed', 'false');
  const returnButton = button('返回实际状态', 'ocv3-return');
  const modeHint = element('p', 'ocv3-hint');
  modeHint.id = `${prefix}-mode-hint`;
  demoButton.setAttribute('aria-describedby', modeHint.id);
  returnButton.setAttribute('aria-describedby', modeHint.id);
  modeActions.append(demoButton, returnButton);
  modeSection.node.append(modeActions, modeHint);

  const viewSection = section('视图', 'view');
  const viewGroup = element('div', 'ocv3-view-buttons');
  viewGroup.setAttribute('role', 'group');
  viewGroup.setAttribute('aria-labelledby', viewSection.heading.id);
  const viewHint = element('p', 'ocv3-hint', '点席位只选择；点「聚焦工位」才放大。');
  viewHint.id = `${prefix}-view-hint`;
  for (const [view, label] of VIEWS) {
    const control = button(label);
    control.setAttribute('aria-label', view === 'workstation' ? '聚焦选中工位并放大视图' : `切换到${label}视图`);
    control.setAttribute('aria-pressed', 'false');
    control.setAttribute('aria-describedby', viewHint.id);
    control.dataset.ocv3View = view;
    viewGroup.append(control);
    viewButtons.set(view, control);
    listen(control, 'click', () => runAction('view', `切换${label}视图`, state => {
      if (view === 'workstation' && !state.active) throw new Error('请先选择一个工位。');
      return runtime.setView(view);
    }));
  }
  viewSection.node.append(viewGroup, viewHint);

  for (const region of REGIONS) {
    const group = section(region.label, region.id);
    group.node.classList.add(`ocv3-region--${region.id}`);
    const grid = element('div', 'ocv3-seats');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-labelledby', group.heading.id);
    const empty = element('p', 'ocv3-hint', '等待工位数据…');
    group.node.append(grid, empty);
    regions.set(region.id, { ...group, grid, empty });
    listen(grid, 'click', event => {
      const target = event.target?.closest?.('button[data-ocv3-station]');
      if (!target || !grid.contains(target)) return;
      const id = target.dataset.ocv3Station;
      void runAction('selection', '选择工位', state => {
        const station = state.stations.find(item => item.id === id);
        if (!station) throw new Error('这个工位已不在当前运行时中，请刷新后重试。');
        // Selection does not change the camera. Only the explicit focus/view control does.
        return runtime.selectStation(station.id, { focus: false });
      });
    });
  }

  const activeSection = section('选中工位', 'active');
  const activeName = element('p', 'ocv3-active-name', '尚未选择');
  const activeMeta = element('p', 'ocv3-active-meta');
  const sourceLine = element('div', 'ocv3-source-line');
  const bindingLabel = element('span', 'ocv3-binding');
  const sourceLabel = element('span', 'ocv3-source');
  sourceLine.append(bindingLabel, sourceLabel);
  const directionRow = element('div', 'ocv3-direction-row');
  const directionLabel = element('label', 'ocv3-field-label', '坐姿方向');
  const directionSelect = element('select', 'ocv3-direction');
  directionSelect.id = `${prefix}-direction`;
  directionSelect.setAttribute('aria-label', '选中工位的坐姿方向');
  directionLabel.htmlFor = directionSelect.id;
  const placeholder = element('option', '', '请选择工位');
  placeholder.value = '';
  placeholder.disabled = true;
  directionSelect.append(placeholder);
  for (const [value, label] of DIRECTIONS) {
    const option = element('option', '', label);
    option.value = value;
    directionSelect.append(option);
  }
  directionRow.append(directionLabel, directionSelect);
  const stateLabel = element('p', 'ocv3-field-label', '本地演示状态');
  stateLabel.id = `${prefix}-states`;
  const stateGroup = element('div', 'ocv3-state-buttons');
  stateGroup.setAttribute('role', 'group');
  stateGroup.setAttribute('aria-labelledby', stateLabel.id);
  const stateHint = element('p', 'ocv3-hint');
  stateHint.id = `${prefix}-state-hint`;
  for (const [state, label] of STATES) {
    const control = button(label);
    control.dataset.ocv3State = state;
    control.setAttribute('aria-label', `将选中工位的本地演示状态设为${label}`);
    control.setAttribute('aria-describedby', stateHint.id);
    control.setAttribute('aria-pressed', 'false');
    stateButtons.set(state, control);
    stateGroup.append(control);
    listen(control, 'click', () => runAction('state', `设置${label}演示状态`, current => {
      // Read again at activation: never rely on an old enabled button or a live slot's source.
      if (!current.demoMode) throw new Error('请先进入演示模式；这里不能修改实际工作状态。');
      if (!current.active) throw new Error('请先选择一个工位。');
      return runtime.setStationState(current.active.id, state, { detail: `本地演示：${label}`, source: 'demo' });
    }));
  }
  const detailList = element('dl', 'ocv3-detail');
  const detailLabel = element('dt', 'ocv3-field-label', '状态详情');
  const detailValue = element('dd', 'ocv3-detail-text');
  detailValue.tabIndex = 0;
  detailValue.setAttribute('aria-label', '选中工位的状态详情');
  detailList.append(detailLabel, detailValue);
  activeSection.node.append(activeName, activeMeta, sourceLine, directionRow, stateLabel, stateGroup, stateHint, detailList);

  function readSnapshot() {
    const raw = runtime.snapshot();
    if (!raw || typeof raw !== 'object') throw new Error('snapshot() 未返回有效对象。');
    if (raw.ready && !Array.isArray(raw.stations)) throw new Error('snapshot.stations 必须是工位数组。');
    const ids = new Set();
    const stations = (Array.isArray(raw.stations) ? raw.stations : []).map(station => {
      if (!station || typeof station !== 'object') throw new Error('工位数据不是有效对象。');
      const id = text(station.id);
      if (!id || ids.has(id)) throw new Error(`工位 ID 缺失或重复：${id || '空 ID'}。`);
      ids.add(id);
      const region = REGIONS.find(item => item.aliases.includes(station.region));
      if (!region) throw new Error(`工位 ${id} 分区无效：需 west/red 或 east/green。`);
      return {
        id, name: text(station.name, id) || id, role: roleText(station.role), region,
        bound: station.bound === true, source: text(station.source, 'unbound'),
        state: text(station.state), direction: text(station.direction), detail: text(station.detail),
        selected: station.selected === true,
      };
    });
    const activeId = text(raw.activeStation);
    const active = stations.find(station => station.id === activeId)
      || (!activeId ? stations.find(station => station.selected) : null) || null;
    return { ready: raw.ready === true, demoMode: raw.demoMode === true, view: text(raw.view), stations, active, unplaced: (Array.isArray(raw.unplacedAgents) ? raw.unplacedAgents : []).map(agent => text(agent.name, 'AI同事')) };
  }

  function showError(message) {
    setText(alert, message);
    alert.hidden = false;
  }
  function announce(message) {
    setText(status, message);
  }
  function summary(state) {
    const selection = state.active
      ? `已选${state.active.region.label}${state.active.name}，${sourceText(state.active)}，${stateText(state.active)}。`
      : '尚未选择工位。';
    return `${selection}当前${viewNames.get(state.view) || '未知'}视图，${state.demoMode ? '演示' : '实际'}模式。`;
  }
  function renderSeats(state) {
    const kept = new Set();
    for (const region of REGIONS) {
      const group = regions.get(region.id);
      const stations = state.stations.filter(station => station.region.id === region.id);
      setText(group.heading, `${region.label} · ${stations.length} 席`);
      group.empty.hidden = stations.length > 0;
      setText(group.empty, state.ready ? '此分区暂无工位。' : '等待工位数据…');
      for (const [index, station] of stations.entries()) {
        let nodes = seatNodes.get(station.id);
        if (!nodes) {
          const seat = button('', 'ocv3-seat');
          seat.dataset.ocv3Station = station.id;
          const number = element('span', 'ocv3-seat-number');
          number.setAttribute('aria-hidden', 'true');
          const content = element('span', 'ocv3-seat-content');
          const name = element('span', 'ocv3-seat-name');
          const meta = element('span', 'ocv3-seat-meta');
          content.append(name, meta);
          seat.append(number, content);
          nodes = { seat, number, name, meta };
          seatNodes.set(station.id, nodes);
        }
        kept.add(station.id);
        const selected = state.active?.id === station.id;
        setText(nodes.number, String(index + 1).padStart(2, '0'));
        setText(nodes.name, station.name);
        setText(nodes.meta, `${station.role} · ${station.source === 'demo' ? '演示' : stateText(station)}`);
        nodes.seat.setAttribute('aria-pressed', String(selected));
        nodes.seat.setAttribute('aria-label', `${region.label}第${index + 1}席，${station.name}，${station.role}，${station.bound ? '已绑定' : '未绑定'}，${sourceText(station)}，${stateText(station)}`);
        nodes.seat.title = `${station.name} · ${sourceText(station)} · ${stateText(station)}`;
        nodes.seat.disabled = !state.ready || Boolean(pending);
        // Keep existing nodes/focus stable when only names or states change.
        const position = group.grid.children[index];
        if (position !== nodes.seat) group.grid.insertBefore(nodes.seat, position || null);
      }
    }
    for (const [id, nodes] of seatNodes) {
      if (!kept.has(id)) {
        nodes.seat.remove();
        seatNodes.delete(id);
      }
    }
  }
  function render(state) {
    const busy = Boolean(pending);
    const active = state.active;
    const westCount = state.stations.filter(station => station.region.id === 'west').length;
    const eastCount = state.stations.filter(station => station.region.id === 'east').length;
    const hasDemoSource = state.stations.some(station => station.source === 'demo');
    root.dataset.ocv3Mode = state.demoMode ? 'demo' : 'actual';
    setText(counts, `红 ${westCount} · 绿 ${eastCount} · 合计 ${state.stations.length} 席`);
    setText(readiness, !state.ready ? '等待办公室就绪…'
      : westCount === 8 && eastCount === 8 ? '红区 8 席 / 绿区 8 席，独立选择与状态。'
        : '席位数量不符：应为红区 8 + 绿区 8，共 16 席。');
    unplacedNotice.hidden = state.unplaced.length === 0;
    setText(unplacedNotice, state.unplaced.length ? `${state.unplaced.length} 位已授权 AI 暂未分配工位：${state.unplaced.join('、')}。现有在线绑定和主工位不会被抢占。` : '');
    setText(modeLabel, state.demoMode ? '演示模式 · 非实际工作状态'
      : hasDemoSource ? '实际模式 · 仍有演示来源，请返回实际状态' : '实际模式 · 本地状态已锁定');
    demoButton.disabled = !state.ready || busy || state.demoMode;
    demoButton.setAttribute('aria-pressed', String(state.demoMode));
    setText(demoButton, state.demoMode ? '演示模式已开启' : '进入演示模式');
    returnButton.disabled = !state.ready || busy || (!state.demoMode && !hasDemoSource);
    setText(modeHint, state.demoMode
      ? '仅演示本地显示，不提交工作状态；返回时由运行时恢复实际来源，未绑定仍未绑定。'
      : '状态按钮仅限演示。实际工作状态继续由原有 API 同步。');
    for (const [view, control] of viewButtons) {
      control.setAttribute('aria-pressed', String(state.view === view));
      control.disabled = !state.ready || busy || (view === 'workstation' && !active);
    }
    renderSeats(state);
    setText(activeName, active?.name || '尚未选择');
    setText(activeMeta, active ? `${active.region.label} · ${active.role} · ${stateText(active)}` : '在红区或绿区点选一个席位。');
    sourceLine.hidden = !active;
    setText(bindingLabel, active ? active.bound ? '已绑定' : '未绑定' : '');
    setText(sourceLabel, active ? `来源：${sourceText(active)}` : '');
    sourceLabel.dataset.ocv3Source = active && Object.hasOwn(SOURCES, active.source) ? active.source : 'unknown';
    directionSelect.disabled = !state.ready || !active || busy;
    directionRow.setAttribute('aria-busy', String(pending?.kind === 'direction'));
    setText(placeholder, active ? '方向未知' : '请选择工位');
    const direction = pending?.kind === 'direction' && pending.stationId === active?.id ? pending.direction : active?.direction;
    directionSelect.value = directionNames.has(direction) ? direction : '';
    for (const [value, control] of stateButtons) {
      control.disabled = !state.ready || !active || !state.demoMode || busy;
      control.setAttribute('aria-pressed', String(Boolean(active && active.source !== 'unbound' && active.state === value)));
    }
    setText(stateHint, !active ? '请先选择工位。' : state.demoMode
      ? '可切换六种本地演示状态。此操作不会提交到后端。' : '实际模式下不可操作，请先进入演示模式。');
    setText(detailValue, active?.detail || (active?.source === 'unbound'
      ? '此席位未绑定，不代表任何人的实际工作状态。' : active ? '暂无状态详情。' : '选择席位后显示来源与详情。'));
  }

  function refresh() {
    if (destroyed) return false;
    try {
      snapshot = readSnapshot();
      render(snapshot);
      const nextSummary = snapshot.ready ? summary(snapshot) : '办公室尚未就绪。';
      if (nextSummary !== lastSummary && !pending) announce(nextSummary);
      lastSummary = nextSummary;
      return true;
    } catch (error) {
      snapshot = null;
      for (const control of root.querySelectorAll('button:not(.ocv3-refresh), select')) control.disabled = true;
      setText(readiness, '运行时数据暂不可用，可点击刷新重试。');
      showError(`刷新工位面板失败：${errorText(error)}`);
      return false;
    }
  }

  async function runAction(kind, label, action) {
    if (destroyed || pending) return;
    const previousFocus = root.contains(doc.activeElement) ? doc.activeElement : null;
    pending = { kind };
    alert.hidden = true;
    setText(alert, '');
    if (snapshot) render(snapshot);
    announce(`${label}处理中…`);
    let succeeded = false;
    try {
      const current = readSnapshot();
      if (!current.ready) throw new Error('办公室尚未就绪，请稍后重试。');
      await action(current);
      succeeded = true;
    } catch (error) {
      if (!destroyed) showError(`${label}失败：${errorText(error)}`);
    } finally {
      pending = null;
      if (!destroyed) {
        if (refresh()) {
          announce(succeeded ? `${label}完成。${summary(snapshot)}` : `${label}未完成，请查看错误提示。`);
        }
        // Native disabled controls can drop focus. Keep keyboard users in the panel,
        // but never steal focus back after they deliberately move to another control.
        if (previousFocus && (doc.activeElement === doc.body || doc.activeElement === previousFocus)) {
          let target = previousFocus;
          if (previousFocus === demoButton && snapshot?.demoMode) target = returnButton;
          if (previousFocus === returnButton && !snapshot?.demoMode) target = demoButton;
          if (!target.isConnected || target.disabled) target = root;
          target.focus({ preventScroll: true });
        }
      }
    }
  }

  listen(refreshButton, 'click', () => {
    alert.hidden = true;
    setText(alert, '');
    refresh();
  });
  listen(demoButton, 'click', () => runAction('mode', '进入演示模式', () => runtime.setDemoMode(true)));
  listen(returnButton, 'click', () => runAction('mode', '返回实际状态', () => runtime.setDemoMode(false)));
  listen(directionSelect, 'change', () => {
    const direction = directionSelect.value;
    void runAction('direction', '切换坐姿方向', state => {
      if (!state.active) throw new Error('请先选择一个工位。');
      if (!directionNames.has(direction)) throw new Error('坐姿只支持上、下、左、右四个方向。');
      pending.stationId = state.active.id;
      pending.direction = direction;
      render(state);
      return runtime.setStationDirection(state.active.id, direction);
    });
  });
  // No RAF, timer, global state setter, or runtime lifecycle takeover.
  listen(eventTarget, 'office-runtime-change', refresh);
  parent.append(root);
  refresh();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const removeListener of listeners) removeListener();
    listeners.length = 0;
    seatNodes.clear();
    root.remove();
  }
  return { destroy, refresh };
}

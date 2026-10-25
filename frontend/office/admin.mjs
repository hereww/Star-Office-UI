import { el, button, field, formatTime, labelledValue, workBadge, setNotice, makeDialog, fixtureBanner } from './dom.mjs';
import { DEFAULT_CHARACTER_PROFILE_ID, SEAT_IDS, VIEWS, ROCK_ROOM_PERFORMERS, initialSnapshot, publicSnapshot, failedSnapshot, safeAppearance, safeRoomCharacters, bindingCharacterProfileId, statistics, validateBindings, validateDisplay } from './model.mjs';
import { toRuntimeSnapshot } from './codec.mjs';
import { pollSnapshot, errorMessage } from './transport.mjs';
import { createOfficeMap } from './map-loader.mjs';
import { privateTelemetryMetadata } from './admin-codec.mjs';
import { isRuntimeReadyCharacterProfile } from '../company-office/character-profile-runtime.mjs';

const PAGES = [['overview', '运行概览', '01'], ['bindings', '工位绑定', '02'], ['demo', '动画预览', '03'], ['display', '显示设置', '04'], ['diagnostics', '数据源诊断', '05']];
const STATES = [['idle', '休息'], ['writing', '工作'], ['researching', '研究'], ['executing', '执行'], ['syncing', '同步'], ['error', '异常']];
const DIRECTIONS = [['up', '↑ 上'], ['down', '↓ 下'], ['left', '← 左'], ['right', '→ 右']];
const STATIC_CONCEPT_SOURCES = Object.freeze({
  'ragdoll-v1': new URL('./media/character-breed-candidates/ragdoll-v1.png', import.meta.url).href,
  'british-shorthair-v1': new URL('./media/character-breed-candidates/british-shorthair-v1.png', import.meta.url).href,
  'american-shorthair-v1': new URL('./media/character-breed-candidates/american-shorthair-v1.png', import.meta.url).href,
  'tabby-v1': new URL('./media/character-breed-candidates/tabby-v1.png', import.meta.url).href,
  'tuxedo-cat-v1': new URL('./media/character-breed-candidates/tuxedo-cat-v1.png', import.meta.url).href,
  'white-lion-cat-v1': new URL('./media/character-breed-candidates/white-lion-cat-v1.png', import.meta.url).href,
  'jianzhou-cat-v1': new URL('./media/character-breed-candidates/jianzhou-cat-v1.png', import.meta.url).href,
});
const clone = value => structuredClone(value);
/** Read-only metadata nodes, also exercised by focused DOM tests. */
export function renderAdminMetadata(user) {
  const metadata = privateTelemetryMetadata(user);
  const valueRow = (label, value, attrs) => el('div', { class: 'data-pair' }, el('dt', {}, label), el('dd', attrs, value));
  return {
    observed: valueRow('并发观测 · 北京时间', metadata.lastObservedAt === null ? '未知' : formatTime(metadata.lastObservedAt), {
      'data-testid': 'admin-last-observed', 'data-observed-field': 'concurrency', 'data-observed-at': metadata.lastObservedAt,
    }),
    qualities: el('div', { class: 'quality-list' }, metadata.qualities.map(row => valueRow(row.label, row.text, {
      'data-testid': `admin-quality-${row.field}`, 'data-quality-source': row.source, 'data-quality-code': row.code,
    }))),
  };
}

export async function mount(root, config, api) {
  let disposed = false, session = null, page = 'overview', saved = null, draft = null, history = [], telemetry = null, snapshot = initialSnapshot(), characterProfiles = [];
  const fallbackCharacterProfiles = [{ id: DEFAULT_CHARACTER_PROFILE_ID, label: '橘猫', status: 'ready', productionReady: true, assignable: true, directions: ['up', 'down', 'left', 'right'], actions: ['working', 'idle', 'syncing', 'error'], description: 'V5 固定坐姿表情模板，共享长桌与屏幕效果。' }];
  let map = null, stopPolling = null, usersTimer = null, sessionTimer = null, loadingUsers = false, operation = false, dirty = false, previewed = false, selected = 'desk-12', mapGeneration = 0;
  let shell, content, mapHost, mapNotice, notice, saveBar, privateDetails, overviewList, diagnostics, versionLabel, previewTag;
  const dialog = makeDialog('确认配置操作');
  const beforeUnload = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  function stop() { cancelAnimationFrame(previewFrame); playerGeneration++; mapGeneration++; map?.dispose(); map = null; stopPolling?.(); stopPolling = null; clearInterval(usersTimer); usersTimer = null; clearInterval(sessionTimer); sessionTimer = null; }
  function lock(message = '') { stop(); session = null; saved = null; draft = null; telemetry = null; history = []; dirty = false; loginScreen(message); }
  function show(message, kind = 'info') { if (notice) setNotice(notice, message, kind); }
  function loginScreen(message = '') {
    const secure = location.protocol === 'https:';
    const info = el('div', { class: 'notice', role: 'status', hidden: !message }, message);
    const username = el('input', { name: 'username', 'data-testid': 'admin-username', autocomplete: 'username', value: 'admin', required: true, maxlength: 80 });
    const password = el('input', { type: 'password', name: 'password', 'data-testid': 'admin-password', autocomplete: 'current-password', required: true, maxlength: 512 });
    const submit = el('button', { type: 'submit', class: 'primary-button', 'data-testid': 'admin-login', disabled: !secure }, '登录控制台 →');
    const form = el('form', { class: 'login-form', onsubmit: async event => {
      event.preventDefault(); if (!secure || submit.disabled) return; submit.disabled = true;
      try {
        const unauth = await api.session(); session = await api.login(password.value, unauth, username.value.trim()); password.value = '';
        if (!session.authenticated) throw new Error('not authenticated'); await openConsole();
      } catch (error) { password.value = ''; session = null; setNotice(info, errorMessage(error), 'error'); }
      finally { submit.disabled = !secure; }
    } }, field('管理员账号', username), field('密码', password, '密码仅发送至当前办公室服务，不保存在浏览器。'), submit);
    root.replaceChildren(el('main', { class: 'login-shell', id: 'main-content', tabindex: '-1' },
      el('section', { class: 'login-story' }, el('span', { class: 'eyebrow' }, 'STAR OFFICE / ADMIN'), el('div', { class: 'login-emblem', 'aria-hidden': 'true' }, '律'), el('h1', {}, '让办公室，\n清晰而有序。'), el('p', {}, '已确认的场景，不变的角色。\n只把真正可信的状态，放回工位。'), el('div', { class: 'login-story-footer' }, 'V5 连排工位', el('span', {}, '内网 · 独立管理入口'))),
      el('section', { class: 'login-card' }, el('span', { class: 'eyebrow' }, 'WELCOME BACK'), el('h2', {}, '办公室控制台'), el('p', { class: 'muted' }, '登录后管理绑定、查看遥测与预览动画。'), info,
        secure ? form : el('div', { class: 'notice', 'data-kind': 'error' }, '管理入口必须使用同源 HTTPS。本地隔离验收同样需要 TLS；请使用已信任的 HTTPS 管理地址。'),
        el('p', { class: 'privacy-note' }, '管理员遥测仅在登录会话中读取。员工页与管理端权限分离。'))));
    if (config.preview_fixture === true) root.prepend(fixtureBanner());
  }
  const normalizeCharacterProfile = profile => ({
    id: profile?.id,
    label: profile?.label,
    breed: profile?.breed,
    status: profile?.status,
    productionReady: profile?.productionReady === true || profile?.production_ready === true,
    assignable: profile?.assignable === true,
    directions: Array.isArray(profile?.directions) ? profile.directions.slice(0, 8) : [],
    actions: Array.isArray(profile?.actions) ? profile.actions.slice(0, 8) : [],
    templateId: profile?.templateId || profile?.template_id,
    description: typeof profile?.description === 'string' ? profile.description.slice(0, 240) : '',
    fallbackProfileId: profile?.fallbackProfileId || profile?.fallback_profile_id || null,
  });
  const validCharacterProfiles = value => Array.isArray(value?.profiles) ? value.profiles.map(normalizeCharacterProfile).filter(profile => typeof profile.id === 'string' && typeof profile.label === 'string' && typeof profile.status === 'string') : [];
  async function loadCharacterProfiles() {
    // The server-owned catalog is authoritative for assignment state. The static
    // catalog remains a compatibility fallback for older releases only.
    try {
      const profiles = validCharacterProfiles(await api.characterProfiles());
      if (profiles.length) return profiles;
    } catch {}
    try {
      const response = await fetch(new URL('../company-office/character-catalog.json', config.releasePrefix), { cache: 'no-store' });
      if (!response.ok) throw new Error('catalog');
      const profiles = validCharacterProfiles(await response.json());
      return profiles.length ? profiles : fallbackCharacterProfiles;
    } catch { return fallbackCharacterProfiles; }
  }
  async function openConsole() {
    const [configuration, users, profiles] = await Promise.all([api.config(), api.users(), loadCharacterProfiles()]);
    if (disposed) return;
    characterProfiles = profiles;
    saved = configuration.config; draft = clone(saved); draft.appearance = safeAppearance(draft.appearance); draft.room_characters = safeRoomCharacters(draft.room_characters); history = configuration.history; telemetry = users; dirty = false;
    buildConsole();
    stopPolling = pollSnapshot(api, input => { snapshot = publicSnapshot(input); updateLive(); }, error => { snapshot = failedSnapshot(snapshot); updateLive(); if (error?.status === 401) lock('登录已失效，请重新登录。'); });
    usersTimer = setInterval(refreshUsers, 10_000); void refreshUsers();
    // Keep an actively used admin tab alive. The server-side endpoint renews
    // the same opaque token and returns a fresh CSRF value; no credential is
    // stored or re-sent by this heartbeat.
    sessionTimer = setInterval(async () => {
      if (disposed || !session?.authenticated) return;
      const activeSession = session;
      try {
        const refreshed = await api.session();
        if (session !== activeSession || disposed) return;
        if (!refreshed.authenticated) { lock('登录已失效，请重新登录。'); return; }
        session = refreshed;
      } catch (error) {
        if (session !== activeSession || disposed) return;
        if (error?.status === 401 || error?.status === 403) lock(errorMessage(error));
      }
    }, 5 * 60 * 1000);
  }
  async function refreshUsers() {
    if (disposed || !session?.authenticated || loadingUsers) return; loadingUsers = true; const activeSession = session;
    try { const result = await api.users(); if (session === activeSession && session?.authenticated && !disposed) { telemetry = result; renderPrivate(); renderDiagnostics(); } }
    catch (error) { if (session !== activeSession || disposed) return; telemetry = null; renderPrivate(); renderDiagnostics(); if (error?.status === 401 || error?.status === 403) lock(errorMessage(error)); else show('管理员遥测暂不可用，已清除本页缓存详情。', 'error'); }
    finally { loadingUsers = false; }
  }
  function buildConsole() {
    notice = el('div', { class: 'notice admin-notice', 'data-testid': 'admin-notice', role: 'status', hidden: true });
    versionLabel = el('span', { class: 'version-chip' }, `配置 v${saved.version}`);
    const nav = el('nav', { class: 'admin-nav', 'aria-label': '控制台页面' }, PAGES.map(([id, title, number]) => button([number, title].join('  '), () => switchPage(id), { class: 'nav-item', 'data-testid': `nav-${id}`, 'data-page': id, 'aria-current': id === page ? 'page' : 'false' })));
    const sidebar = el('aside', { class: 'admin-sidebar' }, el('div', { class: 'admin-brand' }, el('span', { class: 'brand-mark' }, '律'), el('strong', {}, '办公室控制台'), el('span', { class: 'eyebrow' }, 'STAR OFFICE / ADMIN')), nav,
      el('div', { class: 'sidebar-foot' }, versionLabel, el('small', {}, '配置与实时数据分开管理。'), button('退出登录 ↗', async () => {
        if (dirty && !await confirm('放弃未保存草稿并退出？', '仅丢弃本页草稿，不改动服务端配置。')) return;
        try { await api.logout(session); lock('已退出登录。'); } catch { lock('本页详情已清除；服务端退出未确认，请关闭页面并确认会话。'); }
      }, { class: 'quiet-button logout-button', 'data-testid': 'admin-logout' })));
    content = el('main', { id: 'main-content', class: 'admin-main', tabindex: '-1' });
    shell = el('div', { class: 'admin-shell' }, sidebar, content); root.replaceChildren(shell); if (config.preview_fixture === true) root.prepend(fixtureBanner()); renderPage();
  }
  async function switchPage(next) { if (next === page) return; page = next; mapGeneration++; map?.dispose(); map = null; renderPage(); }
  function renderPage() {
    mapGeneration++; map?.dispose(); map = null; cancelAnimationFrame(previewFrame); playerGeneration++; previewHost = null; previewPlayer = null; demoProfileSelect = demoProfileTitle = demoProfileStatus = demoProfileNotice = null; demoDirectionButtons = []; demoStateButtons = []; saveBar = null;
    for (const item of shell.querySelectorAll('[data-page]')) item.setAttribute('aria-current', item.dataset.page === page ? 'page' : 'false');
    overviewList = privateDetails = diagnostics = null;
    const title = PAGES.find(([id]) => id === page)[1];
    const descriptions = { overview: '关注当前工位，而不是猜测员工在做什么。', bindings: '一个用户，一张工位。展示名只用于员工视图。', demo: '八种猫四向、六种状态均已接入；所有变化都留在这个演示场景。', display: '让不同屏幕上的办公室都清晰、安静。', diagnostics: '查看采样与授权边界；这里不提供凭据编辑。' };
    content.replaceChildren(el('header', { class: 'admin-page-header' }, el('div', {}, el('span', { class: 'eyebrow' }, `CONTROL ROOM / ${page.toUpperCase()}`), el('h1', {}, title), el('p', { class: 'muted' }, descriptions[page])), el('span', { class: 'portal-badge' }, '● 管理员会话')), notice);
    if (page === 'overview') overviewPage(); else if (page === 'bindings') bindingsPage(); else if (page === 'demo') demoPage(); else if (page === 'display') displayPage(); else diagnosticsPage();
  }
  function makeMap(mode = 'employee') {
    mapHost = el('div', { class: 'map-host', 'data-testid': 'office-map', 'aria-label': mode === 'demo' ? '仅本地演示办公室地图' : '办公室地图' });
    mapNotice = el('div', { class: 'map-loading', role: 'status' }, '正在加载 V5 场景…');
    previewTag = el('span', { class: 'demo-tag', 'data-testid': 'local-demo-marker', hidden: mode !== 'demo' }, '本地演示 · 不写真实状态');
    const mapShell = el('section', { class: `map-shell admin-map ${mode === 'demo' ? 'demo-map' : ''}` }, mapHost, mapNotice, previewTag);
    let zoomLocked = true;
    const viewButtons = VIEWS.map(([value, label]) => button(label, () => {
      map?.setView(value);
      for (const control of viewButtons) control.setAttribute('aria-pressed', String(control.dataset.view === value));
    }, { class: 'view-button', 'data-testid': `admin-view-${mode}-${value}`, 'data-view': value, 'aria-pressed': String(value === 'overview') }));
    const zoomLockButton = button('', () => {
      zoomLocked = !zoomLocked;
      map?.setZoomLocked(zoomLocked);
      updateMapControls();
    }, { class: 'view-button zoom-lock-button', 'data-testid': `admin-map-zoom-lock-${mode}`, 'aria-pressed': 'true' });
    const restoreButton = button('↺ 恢复画面', () => {
      map?.setView('overview');
      for (const control of viewButtons) control.setAttribute('aria-pressed', String(control.dataset.view === 'overview'));
    }, { class: 'view-button map-restore-button', 'data-testid': `admin-map-restore-${mode}`, title: '恢复默认全景视图；不修改配置' });
    const updateMapControls = () => {
      zoomLockButton.textContent = zoomLocked ? '🔒 缩放已锁定' : '🔓 可缩放';
      zoomLockButton.setAttribute('aria-pressed', String(zoomLocked));
      zoomLockButton.setAttribute('aria-label', zoomLocked ? '解锁控制台地图缩放' : '锁定控制台地图缩放');
      zoomLockButton.title = zoomLocked ? '已锁定滚轮缩放；点击解锁后可放大或缩小地图' : '点击锁定地图缩放，防止滚轮误操作';
    };
    updateMapControls();
    const controls = el('div', { class: 'admin-map-controls', 'aria-label': '地图操作' }, el('div', { class: 'view-switch', 'aria-label': '地图视角' }, viewButtons), zoomLockButton, restoreButton);
    const generation = ++mapGeneration;
    // Start only after the host participates in layout, so DPR measurements are real.
    requestAnimationFrame(() => {
      if (generation !== mapGeneration || disposed) return;
      void createOfficeMap(mapHost, config, { mode, onSelect: id => { selected = id; if (page === 'overview') { renderOverviewList(); renderPrivate(); } } }).then(handle => {
        if (disposed || generation !== mapGeneration) { handle.dispose(); return; }
        map = handle; map.setZoomLocked(zoomLocked); mapNotice.hidden = true;
        if (mode !== 'demo') { map.applyTelemetrySnapshot(toRuntimeSnapshot(snapshot)); map.applyDisplaySettings(saved.display); }
        else { map.setDemoState(demoState); void renderCharacterPreview(); }
      }).catch(() => { if (generation === mapGeneration && !disposed) { mapNotice.textContent = 'V5 场景暂未就绪，请检查同源资源及运行时适配器。'; mapNotice.classList.add('map-pending'); } });
    });
    return el('div', { class: 'admin-map-wrapper' }, mapShell, controls);
  }
  function overviewPage() {
    overviewList = el('div', { class: 'overview-list' }); privateDetails = el('section', { class: 'panel admin-user-details', 'data-testid': 'admin-telemetry' });
    content.append(el('div', { class: 'admin-stats', id: 'admin-statistics' }), el('div', { class: 'overview-grid' }, el('div', { class: 'overview-map-column' }, makeMap(), overviewList), privateDetails)); updateLive();
  }
  function updateLive() {
    if (!session?.authenticated) return;
    if (page !== 'demo') map?.applyTelemetrySnapshot(toRuntimeSnapshot(snapshot));
    const count = content?.querySelector('#admin-statistics');
    if (count) { const stats = statistics(snapshot); count.replaceChildren(...[['bound', '已绑定'], ['working', '处理中'], ['idle', '待命'], ['unknown', '未知']].map(([key, label]) => el('div', { class: 'stat-line' }, el('span', {}, label), el('strong', {}, stats[key])))); }
    renderOverviewList(); renderPrivate();
  }
  function renderOverviewList() {
    if (!overviewList) return;
    overviewList.replaceChildren(...snapshot.stations.map(s => button('', () => { selected = s.stationId; map?.selectStation(selected, { focus: false }); renderOverviewList(); renderPrivate(); }, { class: 'overview-seat', 'aria-pressed': String(selected === s.stationId) })));
    Array.from(overviewList.children).forEach((node, i) => { const s = snapshot.stations[i]; node.append(el('span', { class: 'seat-code' }, s.stationId.slice(-2)), el('span', {}, s.displayName), workBadge(s)); });
  }
  function renderPrivate() {
    if (!privateDetails) return;
    const binding = saved?.bindings.find(b => b.seat_id === selected && b.enabled), user = telemetry?.users.find(u => u.user_id === binding?.user_id), station = snapshot.stations.find(s => s.stationId === selected);
    privateDetails.replaceChildren(el('div', { class: 'panel-heading' }, el('span', { class: 'eyebrow' }, 'ADMIN ONLY'), el('h2', {}, station?.displayName || selected)), workBadge(station),
      button('⌖ 聚焦工位', () => map?.selectStation(selected, { focus: true }), { class: 'quiet-button', disabled: !map }));
    if (!binding) { privateDetails.append(el('p', { class: 'muted' }, '这个工位尚未绑定用户。')); return; }
    if (!user) { privateDetails.append(el('p', { class: 'notice' }, '暂无可信用户遥测。不会从旧缓存推测身份或用量。')); return; }
    const q = user.quality?.concurrency ?? (typeof user.quality === 'string' ? user.quality : null), fresh = snapshot.sourceOK && station?.status !== 'unknown' && q === 'fresh';
    const metadata = renderAdminMetadata(user);
    privateDetails.append(el('dl', { class: 'details-data' }, labelledValue('用户 ID', user.user_id), labelledValue('用户名', user.username === '' ? '（空用户名）' : user.username ?? '未知'), labelledValue('邮箱', user.email), labelledValue('当前并发 / 上限', fresh ? `${user.concurrency?.current ?? '未知'} / ${user.concurrency?.limit ?? '未知'}` : '未知'), labelledValue('已入库 Token 总量', user.token_usage?.total ?? '未知'), metadata.observed),
      el('p', { class: 'privacy-note' }, '统计窗口 · 北京时间（Asia/Shanghai）'), windowLabel(telemetry.window), el('h3', {}, '字段质量'), metadata.qualities, el('h3', {}, 'API Key 元数据'), el('div', { class: 'key-list' }, (user.api_keys || []).map(key => el('div', { class: 'key-meta' }, el('strong', {}, key.name === '' ? '（空名称）' : key.name ?? '未知名称'), el('span', {}, `ID ${key.id} · ${key.status ?? '未知状态'}`)))));
    if (!user.api_keys?.length) privateDetails.append(el('p', { class: 'muted' }, '暂无 Key 元数据。'));
  }
  function windowLabel(window) {
    if (!window) return el('p', { class: 'muted small' }, '尚无统计窗口。');
    return el('p', { class: 'muted small' }, `${formatTime(window.start ?? window.start_time ?? window.from)} — ${formatTime(window.end ?? window.end_time ?? window.to)}`);
  }
  function edit() { dirty = true; previewed = false; renderSaveState(); }
  function validation() {
    const error = validateBindings(draft.bindings.map(row => ({ stationId: row.seat_id, userId: row.user_id, displayName: row.display_name }))) || validateDisplay(draft.display);
    if (error) return error;
    const profile = characterProfiles.find(item => item.id === draft.appearance?.character_profile_id);
    if (!profile || profile.assignable !== true || profile.productionReady !== true) return '当前角色素材尚未通过完整运行时与视觉审计，暂不能保存为生产角色。';
    for (const binding of draft.bindings) {
      if (!Object.hasOwn(binding, 'character_profile_id')) continue;
      const assigned = characterProfiles.find(item => item.id === binding.character_profile_id);
      if (!assigned || assigned.assignable !== true || assigned.productionReady !== true) return `${binding.seat_id} 的角色动画尚未就绪，请选择可用角色或跟随全局。`;
    }
    if (draft.bindings.some(b => !telemetry?.source.allowed_user_ids?.includes(b.user_id))) return '当前绑定包含未授权用户；请先在 Sub2API 批准授权。';
    if (![5, 10, 30].includes(draft.collection.poll_interval_seconds)) return '采集周期仅支持 5、10 或 30 秒';
    return null;
  }
  function bindingsPage() {
    const rows = el('div', { class: 'binding-grid' });
    const allowed = telemetry?.source.allowed_user_ids || [];
    const roleDescriptions = [];
    const profileLabel = id => characterProfiles.find(profile => profile.id === id)?.label || '橘猫';
    const ready = profile => profile.assignable === true && profile.productionReady === true;
    const roleOptions = selectedId => characterProfiles.map(profile => el('option', {
      value: profile.id, disabled: !ready(profile) && profile.id !== selectedId,
    }, `${profile.label} · ${ready(profile) ? '可用' : profile.status === 'concept-ready' ? '静态图已完成 · 动画待制作' : profile.status === 'prompt-ready' ? '待生成' : '候选'}`));
    const selectedCharacterId = draft.appearance?.character_profile_id || DEFAULT_CHARACTER_PROFILE_ID;
    const characterSelect = el('select', { 'data-testid': 'character-profile-select', 'aria-label': '全局角色模板' }, roleOptions(selectedCharacterId));
    characterSelect.value = selectedCharacterId;
    const appearanceStatus = el('p', { class: 'muted small', 'data-testid': 'character-profile-status' });
    const updateDefaultDescription = () => {
      const profile = characterProfiles.find(item => item.id === draft.appearance?.character_profile_id) || fallbackCharacterProfiles[0];
      appearanceStatus.textContent = `${profile.description || '固定坐姿表情模板'} · 全部 16 个工位默认使用此角色；已单独选择角色动画的工位使用自己的设置。`;
      roleDescriptions.forEach(update => update());
    };
    characterSelect.addEventListener('change', () => { draft.appearance = { ...safeAppearance(draft.appearance), character_profile_id: characterSelect.value }; updateDefaultDescription(); edit(); });
    const appearancePanel = el('section', { class: 'panel appearance-panel', 'data-testid': 'character-profile-panel' },
      el('span', { class: 'eyebrow' }, 'CHARACTER TEMPLATE'), el('h2', {}, '默认角色动画'),
      field('默认角色', characterSelect), appearanceStatus);
    for (const seatId of SEAT_IDS) {
      const row = draft.bindings.find(b => b.seat_id === seatId);
      const select = el('select', { 'data-testid': `binding-user-${seatId}`, 'aria-label': `${seatId} 绑定用户` }, el('option', { value: '' }, '未绑定 · 空席'), allowed.map(id => { const user = telemetry.users.find(u => u.user_id === id); return el('option', { value: id }, `用户 ${id}${user?.username ? ` · ${user.username}` : ''}`); }));
      if (row && !allowed.includes(row.user_id)) select.append(el('option', { value: row.user_id }, `用户 ${row.user_id} · 已不在授权范围`));
      select.value = row?.user_id || '';
      const alias = el('input', { type: 'text', maxlength: 40, value: row?.display_name || '', placeholder: '员工页展示名', 'data-testid': `binding-alias-${seatId}`, disabled: !row, 'aria-label': `${seatId} 展示名` });
      const enabled = el('input', { type: 'checkbox', 'data-testid': `binding-enabled-${seatId}`, checked: row?.enabled === true, disabled: !row });
      const inherited = el('option', { value: '' }, '跟随全局');
      const roleSelect = el('select', { 'data-testid': `binding-character-${seatId}`, 'aria-label': `${seatId} 角色动画`, disabled: !row }, inherited, roleOptions(row?.character_profile_id));
      roleSelect.value = row?.character_profile_id || '';
      const roleStatus = el('p', { class: 'muted small binding-character-status', 'data-testid': `binding-character-status-${seatId}` });
      roleSelect.setAttribute('aria-describedby', `binding-character-status-${seatId}`);
      roleStatus.id = `binding-character-status-${seatId}`;
      const updateRoleDescription = () => {
        const current = draft.bindings.find(b => b.seat_id === seatId);
        const defaultLabel = profileLabel(draft.appearance?.character_profile_id);
        inherited.textContent = `跟随全局 · ${defaultLabel}`;
        if (!current) { roleStatus.textContent = '绑定用户后可选择角色动画。'; return; }
        const effectiveId = bindingCharacterProfileId(current, draft.appearance);
        const profile = characterProfiles.find(item => item.id === effectiveId);
        const labels = { working: '工作', idle: '休息', syncing: '同步', error: '异常' };
        const actions = (profile?.actions || fallbackCharacterProfiles[0].actions).map(action => labels[action]).filter(Boolean).join('、');
        roleStatus.textContent = `${current.character_profile_id ? '独立角色' : '跟随全局'} · ${profileLabel(effectiveId)} · ${actions}动画`;
      };
      roleDescriptions.push(updateRoleDescription);
      roleSelect.addEventListener('change', () => {
        const current = draft.bindings.find(b => b.seat_id === seatId); if (!current) return;
        if (roleSelect.value) current.character_profile_id = roleSelect.value; else delete current.character_profile_id;
        updateRoleDescription(); edit();
      });
      const choose = () => {
        const previous = draft.bindings.find(b => b.seat_id === seatId);
        draft.bindings = draft.bindings.filter(b => b.seat_id !== seatId);
        if (select.value) {
          const next = { seat_id: seatId, user_id: select.value, display_name: alias.value.trim() || (seatId === 'desk-12' ? '主工位' : `工位 ${seatId.slice(-2)}`), enabled: true };
          if (previous?.character_profile_id) next.character_profile_id = previous.character_profile_id;
          draft.bindings.push(next);
        } else roleSelect.value = '';
        alias.disabled = enabled.disabled = roleSelect.disabled = !select.value;
        enabled.checked = Boolean(select.value); alias.value = draft.bindings.find(b => b.seat_id === seatId)?.display_name || '';
        updateRoleDescription(); edit();
      };
      select.addEventListener('change', choose);
      alias.addEventListener('input', () => { const current = draft.bindings.find(b => b.seat_id === seatId); if (current) current.display_name = alias.value; edit(); });
      enabled.addEventListener('change', () => { const current = draft.bindings.find(b => b.seat_id === seatId); if (current) current.enabled = enabled.checked; edit(); });
      rows.append(el('section', { class: `binding-card ${row ? 'is-bound' : ''}` }, el('div', { class: 'binding-card-head' }, el('strong', {}, `工位 ${seatId.slice(-2)}`), el('span', { class: 'muted small' }, Number(seatId.slice(-2)) <= 8 ? '红区' : '绿区')), field('授权用户', select), field('展示名', alias), field('角色动画', roleSelect), roleStatus, field('显示此绑定', enabled)));
    }
    updateDefaultDescription();
    content.append(appearancePanel, el('p', { class: 'notice' }, '选择角色动画后，先预览草稿，再保存并读回确认。八种猫的四向与状态动画均已可用，可在动画预览页查看。工作、休息等状态继续跟随实时数据。'), makeMap(), rows, makeSaveBar(), historyPanel());
  }
  function makeSaveBar() {
    saveBar = el('div', { class: 'save-bar' }, el('span', { class: 'save-state', 'data-testid': 'config-save-state', role: 'status' }), button('读取服务端版本', reloadConfig, { class: 'quiet-button', 'data-testid': 'config-read', 'data-read': 'true' }), button('预览草稿', previewDraft, { class: 'secondary-button', 'data-testid': 'config-preview', 'data-preview': 'true' }), button('保存并读回确认', saveConfig, { class: 'primary-button', 'data-testid': 'config-save', 'data-save': 'true' })); renderSaveState(); return saveBar;
  }
  function renderSaveState() {
    if (content) for (const control of [...content.querySelectorAll('.binding-card input, .binding-card select, .appearance-panel select, .display-grid input, .display-grid select, .diagnostics-panel select, .history-row button'), ...shell.querySelectorAll('.nav-item, .logout-button')]) {
      if (operation) { if (!Object.hasOwn(control.dataset, 'wasDisabled')) control.dataset.wasDisabled = String(control.disabled); control.disabled = true; }
      else if (Object.hasOwn(control.dataset, 'wasDisabled')) { control.disabled = control.dataset.wasDisabled === 'true'; delete control.dataset.wasDisabled; }
    }
    if (!saveBar) return; const error = draft ? validation() : '等待服务端配置';
    saveBar.querySelector('.save-state').textContent = error || (dirty ? `未保存草稿 · 基于 v${saved.version}${previewed ? ' · 已预览' : ' · 请先预览'}` : `已读回服务端 v${saved.version}`);
    saveBar.querySelector('[data-save]').disabled = operation || !dirty || !previewed || Boolean(error);
    saveBar.querySelector('[data-preview]').disabled = operation || Boolean(error);
    saveBar.querySelector('[data-read]').disabled = operation;
  }
  async function reloadConfig() {
    if (operation) return;
    if (dirty && !await confirm('重新读取会丢弃当前草稿', '服务端配置不会改变。请先复制需要保留的展示名。')) return;
    operation = true; renderSaveState();
    try { const result = await api.config(); if (!session?.authenticated || disposed) return; saved = result.config; draft = clone(saved); draft.room_characters = safeRoomCharacters(draft.room_characters); history = result.history; dirty = false; versionLabel.textContent = `配置 v${saved.version}`; renderPage(); show('已重新读取服务端配置。'); }
    catch (error) { if (error?.status === 401) lock(errorMessage(error)); else show(errorMessage(error), 'error'); }
    finally { operation = false; renderSaveState(); }
  }
  async function saveConfig() {
    if (operation || validation() || !dirty || !previewed) return;
    if (!await confirm('保存这份配置草稿？', `将基于 v${saved.version} 保存新版本，再重新 GET 比对版本及完整内容。`)) return;
    operation = true; renderSaveState();
    try { const submitted = clone(draft); submitted.bindings = submitted.bindings.map(b => ({ ...b, display_name: b.display_name.trim() })); const result = await api.save(submitted, saved.version, session); if (!session?.authenticated || disposed) return; saved = result.config; draft = clone(saved); draft.room_characters = safeRoomCharacters(draft.room_characters); history = result.history; dirty = false; versionLabel.textContent = `配置 v${saved.version}`; renderPage(); show(`保存成功 · 服务端 v${saved.version} 的版本及内容已读回确认。`, 'success'); }
    catch (error) { if (error?.status === 401) lock(errorMessage(error)); else show(errorMessage(error), 'error'); }
    finally { operation = false; renderSaveState(); }
  }
  async function confirm(title, description) {
    return new Promise(resolve => {
      dialog.replaceChildren(el('h2', {}, title), el('p', { class: 'muted' }, description), el('div', { class: 'dialog-actions' }, button('取消', () => { dialog.close(); resolve(false); }, { class: 'secondary-button', 'data-testid': 'dialog-cancel' }), button('确认', () => { dialog.close(); resolve(true); }, { class: 'primary-button', 'data-testid': 'dialog-confirm' })));
      dialog.addEventListener('cancel', () => resolve(false), { once: true }); dialog.showModal();
    });
  }
  function previewDraft() {
    if (validation()) return;
    const preview = clone(draft), host = el('div', { class: 'map-host', 'data-testid': 'office-map', 'aria-label': '仅本页配置草稿地图预览' });
    const pending = el('div', { class: 'map-loading' }, '正在准备草稿地图…');
    let localMap = null, closed = false;
    const closePreview = () => { closed = true; localMap?.dispose(); };
    dialog.addEventListener('close', closePreview, { once: true });
    dialog.replaceChildren(el('span', { class: 'demo-tag inline' }, '草稿预览 · 未保存'), el('h2', {}, '办公室配置草稿'),
      el('p', { class: 'muted' }, '角色均为未知静态状态；只检查名称、席位与显示偏好，不搬运其他用户的实际状态。'),
      el('div', { class: 'map-shell draft-map' }, host, pending),
      el('div', { class: 'draft-summary' }, preview.bindings.map(b => el('p', {}, `${b.seat_id} → ${b.display_name} · 用户 ${b.user_id} · ${b.enabled ? '启用' : '停用'} · 角色动画：${characterProfiles.find(profile => profile.id === bindingCharacterProfileId(b, preview.appearance))?.label || '橘猫'}${b.character_profile_id ? '（独立选择）' : '（跟随全局）'}`))),
      el('dl', {}, labelledValue('角色模板', characterProfiles.find(profile => profile.id === preview.appearance?.character_profile_id)?.label || '橘猫'), labelledValue('默认视角', VIEWS.find(([v]) => v === preview.display.default_view)?.[1]), labelledValue('采集周期', `${preview.collection.poll_interval_seconds} 秒`)),
      button('已检查草稿，返回编辑', () => { previewed = true; renderSaveState(); dialog.close(); }, { class: 'primary-button', 'data-testid': 'draft-preview-ack' })); dialog.showModal();
    const local = initialSnapshot(); local.display = preview.display; local.appearance = safeAppearance(preview.appearance); local.roomCharacters = safeRoomCharacters(preview.room_characters);
    local.stations = local.stations.map(station => { const binding = preview.bindings.find(b => b.seat_id === station.stationId && b.enabled); return { ...station, bound: Boolean(binding), displayName: binding?.display_name || '空工位', status: binding ? 'unknown' : 'unbound', characterProfileId: bindingCharacterProfileId(binding, preview.appearance), characterLabel: characterProfiles.find(profile => profile.id === bindingCharacterProfileId(binding, preview.appearance))?.label || '橘猫', characterStatus: 'ready' }; });
    void createOfficeMap(host, config).then(handle => {
      if (closed || disposed) { handle.dispose(); return; } localMap = handle;
      handle.applyTelemetrySnapshot(toRuntimeSnapshot(local)); handle.applyDisplaySettings(preview.display); handle.setView(preview.display.default_view); pending.hidden = true;
    }).catch(() => { if (!closed) pending.textContent = '草稿地图暂未就绪；请检查下面的工位配置明细。'; });
  }
  function historyPanel() {
    return el('section', { class: 'panel history-panel' }, el('h2', {}, '配置历史'), el('p', { class: 'muted small' }, '恢复会生成新版本；不会更改插件授权或凭据。'), el('div', { class: 'history-list' }, history.map(h => el('div', { class: 'history-row' }, el('strong', {}, `v${h.version}`), el('span', {}, `${formatTime(h.created_at)} · ${h.action} · ${h.actor}`), button('恢复此版', async () => {
      if (operation || !await confirm(`恢复 v${h.version}？`, '恢复内容将按当前授权重新校验，并形成新版本。未保存草稿将被丢弃。')) return;
      operation = true; renderSaveState();
      try { const result = await api.restore(h.version, saved.version, session); if (!session?.authenticated || disposed) return; saved = result.config; draft = clone(saved); history = result.history; dirty = false; versionLabel.textContent = `配置 v${saved.version}`; renderPage(); show(`已恢复并读回确认新版本 v${saved.version}。`, 'success'); }
      catch (error) { if (error?.status === 401) lock(errorMessage(error)); else show(errorMessage(error), 'error'); }
      finally { operation = false; renderSaveState(); }
    }, { class: 'quiet-button', 'data-testid': `config-restore-${h.version}`, disabled: h.version === saved.version })))));
  }
  function displayPage() {
    const view = el('select', {}, VIEWS.map(([value, label]) => el('option', { value }, label))); view.value = draft.display.default_view; view.addEventListener('change', () => { draft.display.default_view = view.value; edit(); });
    const motion = el('select', {}, [['system', '跟随系统'], ['on', '减少动态效果'], ['off', '完整动画']].map(([value, label]) => el('option', { value }, label))); motion.value = draft.display.reduced_motion; motion.addEventListener('change', () => { draft.display.reduced_motion = motion.value; edit(); });
    const toggles = [['show_bubbles', '显示状态气泡'], ['show_labels', '显示地图标签'], ['details_collapsed', '默认收起详情栏']].map(([key, label]) => { const input = el('input', { type: 'checkbox', checked: draft.display[key] }); input.addEventListener('change', () => { draft.display[key] = input.checked; edit(); }); return field(label, input); });
    const roomCharacters = safeRoomCharacters(draft.room_characters);
    draft.room_characters = roomCharacters;
    const roomEnabled = el('input', { type: 'checkbox', checked: roomCharacters.rock.enabled, 'data-testid': 'rock-room-characters-enabled' });
    const performerFields = ROCK_ROOM_PERFORMERS.map(({ id, label }) => {
      const input = el('input', { type: 'checkbox', checked: roomCharacters.rock.performers[id], 'data-testid': `room-character-${id}` });
      input.addEventListener('change', () => { draft.room_characters.rock.performers[id] = input.checked; edit(); });
      return field(label, input);
    });
    const syncPerformerDisabled = () => performerFields.forEach(control => { const input = control.querySelector('input'); if (input) input.disabled = !roomEnabled.checked; });
    roomEnabled.addEventListener('change', () => { draft.room_characters.rock.enabled = roomEnabled.checked; syncPerformerDisabled(); edit(); });
    syncPerformerDisabled();
    const roomPanel = el('section', { class: 'panel scene-character-panel', 'data-testid': 'scene-character-settings' }, el('h2', {}, '场景角色显示'), el('p', { class: 'muted small' }, '控制已制作的 V5 摇滚房间四角色显示；不修改工位锚点、素材或动画时钟。'), field('显示摇滚房间角色', roomEnabled), el('div', { class: 'scene-character-grid' }, performerFields));
    content.append(el('div', { class: 'display-grid' }, el('section', { class: 'panel' }, el('h2', {}, '显示偏好'), field('默认地图视角', view), field('动态效果', motion), toggles), roomPanel, el('section', { class: 'display-note' }, el('span', { class: 'eyebrow' }, 'CALM BY DESIGN'), el('h2', {}, '清晰，不抢注意力。'), el('p', {}, '地图与角色比例保持已确认版本。\n桌面详情可折叠，手机详情从底部展开。'), el('p', { class: 'muted small' }, '这些偏好不会改变工位锚点、素材、表情时钟或数据权限。'))), makeSaveBar());
  }
  let demoState = 'writing', demoDirection = 'down', demoCharacterProfileId = DEFAULT_CHARACTER_PROFILE_ID, previewHost = null, previewPlayer = null, previewFrame = null, playerGeneration = 0, conceptImagePromises = new Map();
  let demoProfileSelect = null, demoProfileTitle = null, demoProfileStatus = null, demoProfileNotice = null, demoDirectionButtons = [], demoStateButtons = [];
  const demoProfile = () => characterProfiles.find(profile => profile.id === demoCharacterProfileId) || characterProfiles.find(profile => profile.id === DEFAULT_CHARACTER_PROFILE_ID) || fallbackCharacterProfiles[0];
  const hasStaticConcept = profile => Object.hasOwn(STATIC_CONCEPT_SOURCES, profile?.id);
  const loadStaticConcept = profileId => {
    if (!conceptImagePromises.has(profileId)) {
      const source = STATIC_CONCEPT_SOURCES[profileId];
      if (!source) return Promise.reject(new Error('static concept unavailable'));
      conceptImagePromises.set(profileId, new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => { conceptImagePromises.delete(profileId); reject(new Error('static concept unavailable')); };
        image.src = source;
      }));
    }
    return conceptImagePromises.get(profileId);
  };
  function drawStaticConcept(canvas, image) {
    const context = canvas.getContext('2d');
    if (!context || !image.naturalWidth || !image.naturalHeight) throw new Error('static concept invalid');
    const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    context.clearRect(0, 0, canvas.width, canvas.height); context.imageSmoothingEnabled = false;
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  }
  function updateDemoProfileUI(profile = demoProfile()) {
    const runtime = isRuntimeReadyCharacterProfile(profile?.id), concept = hasStaticConcept(profile);
    if (demoProfileSelect && demoProfileSelect.value !== profile?.id) demoProfileSelect.value = profile?.id || DEFAULT_CHARACTER_PROFILE_ID;
    if (demoProfileTitle) demoProfileTitle.textContent = runtime ? `${profile.label} · V5 四向角色动画` : concept ? `${profile.label} · 静态概念图` : `${profile?.label || '角色'} · 预览`;
    if (demoProfileStatus) demoProfileStatus.textContent = runtime ? '动画已就绪 · V5 四向固定坐姿表情，屏幕效果由共享长桌独立播放' : concept ? '静态概念图已完成 · 四向与状态动画待制作' : '当前角色暂无可用预览素材';
    if (demoProfileNotice) demoProfileNotice.textContent = runtime ? '在此预览四向与六种状态；左侧地图同步展示所选猫咪。选择只影响演示，工位角色在工位绑定中保存。' : concept ? '当前展示独立透明静态图。四向坐姿与状态动画待制作，方向与状态按钮仅适用于橘猫。' : '选择只影响本地预览，不会替换地图角色，也不会保存到生产配置。';
    for (const control of [...demoDirectionButtons, ...demoStateButtons]) { control.disabled = !runtime; control.setAttribute('aria-disabled', String(!runtime)); }
  }
  async function renderCharacterPreview() {
    if (!previewHost || page !== 'demo') return;
    const generation = ++playerGeneration, profile = demoProfile(), concept = hasStaticConcept(profile), runtime = isRuntimeReadyCharacterProfile(profile?.id);
    updateDemoProfileUI(profile); cancelAnimationFrame(previewFrame); previewFrame = null; previewPlayer = null;
    if (concept && !runtime) {
      const canvas = el('canvas', { width: 192, height: 192, 'data-testid': 'demo-character-preview-canvas', 'aria-label': `${profile.label}静态概念图，动画待制作` });
      try {
        previewHost.textContent = '正在加载静态概念图…';
        const image = await loadStaticConcept(profile.id);
        if (disposed || generation !== playerGeneration || page !== 'demo') return;
        drawStaticConcept(canvas, image); canvas.dataset.characterProfileId = profile.id; canvas.dataset.conceptSource = STATIC_CONCEPT_SOURCES[profile.id]; previewHost.replaceChildren(canvas);
      } catch { if (generation === playerGeneration && previewHost) previewHost.textContent = '静态概念图暂时无法加载，请重新选择角色重试。'; }
      return;
    }
    if (!runtime || !map) return;
    try {
      const { ConnectedSeatedPlayer } = await import(new URL('../company-office/connected-v5/seated-player.mjs', config.releasePrefix));
      const canvas = el('canvas', { width: 192, height: 192, 'data-testid': 'demo-character-preview-canvas', 'data-runtime-scene': 'company-office-connected-v5', 'data-character-template': 'connected-v5-character-template-v1', 'data-renderer': 'ConnectedSeatedPlayer', 'aria-label': `${DIRECTIONS.find(([v]) => v === demoDirection)?.[1]}朝向，${STATES.find(([v]) => v === demoState)?.[1]}状态，本地素材演示` });
      const assets = await map.runtime.characterAssetsForProfile(profile.id);
      const player = await new ConnectedSeatedPlayer(canvas, assets, { baseUrl: map.runtime.baseUrl, direction: demoDirection, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }).initialize();
      if (disposed || generation !== playerGeneration || page !== 'demo') return;
      previewPlayer = player; previewPlayer.setState(demoState);
      canvas.dataset.characterProfileId = profile.id;
      await map.setDemoCharacterProfile(profile.id);
      map.setDemoState(demoState);
      if (disposed || generation !== playerGeneration || page !== 'demo') return;
      const presentation = player.snapshot(); canvas.dataset.keyboardInteraction = String(presentation.keyboardInteraction); canvas.dataset.furnitureMode = presentation.furnitureMode;
      previewHost.replaceChildren(canvas);
      const start = performance.now();
      const draw = time => { if (page !== 'demo' || disposed || generation !== playerGeneration) return; previewPlayer.sample(time - start); previewFrame = requestAnimationFrame(draw); }; previewFrame = requestAnimationFrame(draw);
    } catch { if (generation === playerGeneration && previewHost) previewHost.textContent = '四向表情预览暂未就绪。'; }
  }
  function demoPage() {
    previewHost = el('div', { class: 'character-preview', role: 'img', 'aria-label': '本地角色预览' }, '素材加载后显示角色');
    const selectedProfile = demoProfile(); demoCharacterProfileId = selectedProfile.id;
    demoProfileSelect = el('select', { 'data-testid': 'demo-character-profile-select', 'aria-label': '动画预览角色' }, characterProfiles.map(profile => el('option', { value: profile.id }, `${profile.label} · ${isRuntimeReadyCharacterProfile(profile.id) ? '已接入动画' : hasStaticConcept(profile) ? '静态图已完成' : '候选预览'}`)));
    demoProfileSelect.value = selectedProfile.id; demoProfileSelect.addEventListener('change', () => { demoCharacterProfileId = demoProfileSelect.value; updateDemoProfileUI(demoProfile()); void renderCharacterPreview(); });
    demoProfileTitle = el('h2', {}, '角色预览'); demoProfileStatus = el('p', { class: 'demo-profile-status', 'data-testid': 'demo-character-preview-status', role: 'status' }); demoProfileNotice = el('p', { class: 'muted small demo-profile-note', 'data-testid': 'demo-character-preview-note' });
    const templateLink = el('a', { href: new URL('../company-office/connected-v5/character-template.json', config.releasePrefix).href, target: '_blank', rel: 'noopener', class: 'small', 'data-testid': 'v5-character-template-link' }, '查看 V5 角色与共享工位模板（JSON）');
    const conceptsLink = el('a', { href: new URL('./character-concepts.html', import.meta.url).href, target: '_blank', rel: 'noopener', class: 'small', 'data-testid': 'static-character-concepts-link' }, '比较七种猫的静态概念图 →');
    demoDirectionButtons = DIRECTIONS.map(([value, label]) => button(label, () => { demoDirection = value; for (const b of demoDirectionButtons) b.setAttribute('aria-pressed', String(b.dataset.direction === value)); void renderCharacterPreview(); }, { class: 'view-button', 'data-testid': `demo-direction-${value}`, 'data-direction': value, 'aria-pressed': String(value === demoDirection) }));
    demoStateButtons = STATES.map(([value, label]) => button(label, () => { demoState = value; map?.setDemoState(value); for (const b of demoStateButtons) b.setAttribute('aria-pressed', String(b.dataset.state === value)); void renderCharacterPreview(); }, { class: 'state-button', 'data-testid': `demo-state-${value}`, 'data-state': value, 'aria-pressed': String(value === demoState) }));
    const directionControls = el('div', { class: 'direction-controls', 'aria-label': '演示朝向' }, demoDirectionButtons), stateControls = el('div', { class: 'state-controls', 'aria-label': '演示状态' }, demoStateButtons);
    content.append(el('div', { class: 'notice demo-notice' }, '演示模式 · 与真实办公室实例分离。状态名称仅用于素材检查，不推断实际任务阶段。'), el('div', { class: 'demo-grid' }, makeMap('demo'), el('section', { class: 'panel demo-controls' }, el('span', { class: 'demo-tag inline' }, '本地演示'), field('预览角色', demoProfileSelect), demoProfileTitle, demoProfileStatus, demoProfileNotice, conceptsLink, templateLink, previewHost, directionControls, el('h3', {}, '六种状态'), stateControls, el('p', { class: 'muted small' }, '所有角色复用 V5 椅子，身体与座位固定。工作、研究和执行共用专注表情；背面保留真实坐姿，屏幕效果独立播放。'), el('p', { class: 'clock-note' }, '12 fps · 工作 / 休息 / 同步 / 异常：60 / 36 / 60 / 12 帧时钟'))));
    updateDemoProfileUI(selectedProfile);
  }
  function diagnosticsPage() { diagnostics = el('section', { class: 'panel diagnostics-panel', 'data-testid': 'source-diagnostics' }); content.append(diagnostics, historyPanel()); renderDiagnostics(); }
  function renderDiagnostics() {
    if (!diagnostics) return;
    const source = telemetry?.source;
    if (!source) { diagnostics.replaceChildren(el('h2', {}, '数据源诊断'), el('p', { class: 'notice' }, '管理员数据源信息暂不可用。')); return; }
    diagnostics.replaceChildren(el('h2', {}, '采集与授权'), el('dl', { class: 'diagnostics-data' }, labelledValue('插件安装 ID', source.installation_id == null ? '未知' : String(source.installation_id)), labelledValue('授权用户范围', (source.allowed_user_ids || []).join('、') || '无授权用户'), labelledValue('数据源状态', { ok: '采集正常', connecting: '连接中', error: '采集异常', stale: '数据过期' }[source.status] || '未知'), labelledValue('最后成功 · 北京时间', formatTime(source.last_success_at)), labelledValue('最后尝试 · 北京时间', formatTime(source.last_attempt_at)), labelledValue('凭据到期 · 北京时间', formatTime(source.credential_expires_at)), labelledValue('脱敏错误码', source.error_code || '无')),
      el('p', { class: 'notice' }, '源地址与消费凭据由服务器管理，此页不读取或编辑凭据。'));
    const interval = el('select', { 'data-testid': 'collection-interval' }, [5, 10, 30].map(value => el('option', { value }, `${value} 秒`))); interval.value = String(draft.collection.poll_interval_seconds); interval.addEventListener('change', () => { draft.collection.poll_interval_seconds = Number(interval.value); edit(); });
    diagnostics.append(field('采集周期（配置草稿）', interval, '浏览器始终每 2 秒读取办公室本地快照，不增加上游采集频率。'), makeSaveBar()); renderSaveState();
  }
  loginScreen();
  const secure = location.protocol === 'https:';
  if (secure) {
    try { session = await api.session(); if (session.authenticated) await openConsole(); }
    catch (error) { if (!disposed) loginScreen(errorMessage(error)); }
  }
  return () => { disposed = true; stop(); cancelAnimationFrame(previewFrame); playerGeneration++; dialog.remove(); window.removeEventListener('beforeunload', beforeUnload); telemetry = null; draft = null; session = null; };
}

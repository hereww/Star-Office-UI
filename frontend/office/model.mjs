import { safeTodayUsage } from './today-usage.mjs';
import { safeActiveModels } from './active-models.mjs';
/** These are UI-only view models, NOT an upstream wire schema. Codec owns wire mapping. */
import { DEFAULT_CHARACTER_PROFILE_ID, runtimeCharacterProfileId, isRuntimeReadyCharacterProfile } from '../company-office/character-profile-runtime.mjs';
export { DEFAULT_CHARACTER_PROFILE_ID } from '../company-office/character-profile-runtime.mjs';
export const SEAT_IDS = Object.freeze(Array.from({ length: 16 }, (_, i) => `desk-${String(i + 1).padStart(2, '0')}`));
export const VIEWS = Object.freeze([['overview', '全景'], ['west', '红区'], ['east', '绿区'], ['workstation', '当前工位']]);
export const STALE_MS = 15_000;
export const CHARACTER_PROFILE_IDS = Object.freeze(['orange-cat-v1', 'ragdoll-v1', 'british-shorthair-v1', 'american-shorthair-v1', 'tabby-v1', 'tuxedo-cat-v1', 'white-lion-cat-v1', 'jianzhou-cat-v1']);
export const ROCK_ROOM_PERFORMERS = Object.freeze([
  Object.freeze({ id: 'drummer-orange-tabby', label: '橘猫鼓手', role: 'drummer' }),
  Object.freeze({ id: 'guitarist-gray', label: '灰猫吉他手', role: 'guitarist' }),
  Object.freeze({ id: 'bassist-tuxedo', label: '奶牛猫贝斯手', role: 'bassist' }),
  Object.freeze({ id: 'vocalist-cream', label: '奶油猫主唱', role: 'vocalist' }),
]);
const DEFAULT_ROOM_CHARACTER_PERFORMERS = Object.freeze(Object.fromEntries(ROCK_ROOM_PERFORMERS.map(({ id }) => [id, true])));
export function safeRoomCharacters(input) {
  const room = input?.rock, performers = room?.performers;
  if (!room || typeof room.enabled !== 'boolean' || !performers || typeof performers !== 'object') {
    return { rock: { enabled: true, performers: { ...DEFAULT_ROOM_CHARACTER_PERFORMERS } } };
  }
  const normalized = Object.fromEntries(ROCK_ROOM_PERFORMERS.map(({ id }) => [id, performers[id] === true]));
  return { rock: { enabled: room.enabled, performers: normalized } };
}
const text = (value, fallback = '', max = 120) => typeof value === 'string' ? value.slice(0, max) : fallback;
export function decimalString(value) {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : null;
}
export function concurrencyValue(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? value : null;
}
export function safeDisplay(input) {
  return { default_view: ['overview', 'west', 'east', 'workstation'].includes(input?.default_view) ? input.default_view : 'overview', show_bubbles: input?.show_bubbles !== false, show_labels: input?.show_labels !== false, details_collapsed: input?.details_collapsed === true, reduced_motion: ['system', 'on', 'off'].includes(input?.reduced_motion) ? input.reduced_motion : 'system' };
}
export function safeAppearance(input) { return { character_profile_id: runtimeCharacterProfileId(input?.character_profile_id), allow_fallback: false }; }
export function bindingCharacterProfileId(binding, appearance) {
  return runtimeCharacterProfileId(isRuntimeReadyCharacterProfile(binding?.character_profile_id) ? binding.character_profile_id : appearance?.character_profile_id);
}
/** Visual placeholders only: never a config migration or a user-ID mapping. */
export function initialSnapshot() {
  const pendingSeats = new Set(['desk-09', 'desk-10', 'desk-11', 'desk-12']);
  return { sampledAt: null, sourceOK: false, sourceStatus: 'connecting', reason: '等待本地采集数据', appearance: safeAppearance(), roomCharacters: safeRoomCharacters(), stations: SEAT_IDS.map(stationId => {
    const bound = pendingSeats.has(stationId);
    return { stationId, bound, displayName: bound ? stationId === 'desk-12' ? '主工位' : `工位 ${stationId.slice(-2)}` : '空工位', status: bound ? 'unknown' : 'unbound', concurrency: null, username: null, identityQuality: bound ? 'unavailable' : 'unbound', identityObservedAt: null, characterProfileId: DEFAULT_CHARACTER_PROFILE_ID, characterLabel: '橘猫', characterStatus: 'ready' };
  }) };
}
const observationFresh = (value, now, staleMs) => {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) && now - timestamp < staleMs && timestamp <= now + 5_000;
};
/** Whitelist projection: no spread of untrusted records into employee UI or runtime. */
export function publicSnapshot(input, { now = Date.now(), failed = false } = {}) {
  const sampledAt = typeof input?.sampledAt === 'string' ? input.sampledAt : null;
  const pollInterval = [5, 10, 30].includes(input?.pollInterval) ? input.pollInterval : 5;
  const staleMs = pollInterval * 3_000;
  const fresh = observationFresh(sampledAt, now, staleMs);
  const sourceOK = input?.sourceOK === true && fresh && !failed;
  const sourceStatus = sourceOK ? 'ok' : failed ? 'error' : input?.sourceStatus === 'error' ? 'error' : !fresh && sampledAt ? 'stale' : ['stale', 'connecting'].includes(input?.sourceStatus) ? input.sourceStatus : 'error';
  const incoming = new Map((Array.isArray(input?.stations) ? input.stations : []).filter(s => SEAT_IDS.includes(s?.stationId)).map(s => [s.stationId, s]));
  const appearance = safeAppearance(input?.appearance), roomCharacters = safeRoomCharacters(input?.roomCharacters);
  return { configVersion: Number.isSafeInteger(input?.configVersion) ? input.configVersion : 0, display: input?.display ? safeDisplay(input.display) : undefined, appearance, pollInterval,
    roomCharacters, generatedAt: typeof input?.generatedAt === 'string' ? input.generatedAt : null, lastAttemptAt: typeof input?.lastAttemptAt === 'string' ? input.lastAttemptAt : null,
    sampledAt, sourceOK, sourceStatus, reason: failed ? '本地快照读取失败；不推测空闲' : !fresh ? '采样尚未就绪或已过期' : !sourceOK ? '数据源异常或尚未跟踪' : '采样时刻状态', stations: SEAT_IDS.map(stationId => {
    const s = incoming.get(stationId), bound = s?.bound === true;
    const rowFresh = observationFresh(s?.observedAt, now, staleMs);
    const concurrency = bound && sourceOK && rowFresh && s?.quality === 'fresh' && s?.status !== 'unknown' ? concurrencyValue(s?.concurrency) : null;
    const status = !bound ? 'unbound' : concurrency === null ? 'unknown' : /^0+$/.test(concurrency) ? 'idle' : 'working';
    const identityObservedAt = typeof s?.identityObservedAt === 'string' ? s.identityObservedAt : null;
    const identityFresh = observationFresh(identityObservedAt, now, staleMs);
    let identityQuality = !bound ? 'unbound' : !sourceOK ? sourceStatus === 'stale' ? 'stale' : 'unavailable' : s?.identityQuality === 'stale' ? 'stale' : 'unavailable';
    if (bound && sourceOK && s?.identityQuality === 'fresh') identityQuality = !identityFresh ? identityObservedAt && Number.isFinite(Date.parse(identityObservedAt)) ? 'stale' : 'unavailable' : typeof s?.username === 'string' ? 'fresh' : 'unavailable';
    const username = identityQuality === 'fresh' ? s.username : null;
    return { stationId, bound, displayName: text(s?.displayName, bound ? '已绑定工位' : '空工位', 40), status, concurrency, limit: bound ? concurrencyValue(s?.limit) : null,
      quality: concurrency === null ? 'unavailable' : 'fresh', characterProfileId: runtimeCharacterProfileId(s?.characterProfileId), characterLabel: runtimeCharacterProfileId(s?.characterProfileId) === s?.characterProfileId ? text(s?.characterLabel, '橘猫', 40) : '橘猫', characterStatus: runtimeCharacterProfileId(s?.characterProfileId) === s?.characterProfileId ? text(s?.characterStatus, 'ready', 32) : 'ready', observedAt: bound && typeof s?.observedAt === 'string' ? s.observedAt : null,
      username, identityQuality, identityObservedAt: bound ? identityObservedAt : null,
      todayUsage: safeTodayUsage(s?.todayUsage, { now, bound, sourceOK, staleMs }),
      activeModels: safeActiveModels(s?.activeModels, { now, bound, sourceOK, sourceStatus, staleMs }) };
  }) };
}
/** Presentation labels never infer identity from an alias, email or account ID. */
export function usernameLabel(station) {
  if (station?.status === 'unbound') return '未绑定';
  if (station?.identityQuality !== 'fresh' || typeof station.username !== 'string') return '用户名未知';
  const visible = station.username.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  return visible.trim() ? visible : '未设置';
}
export function workCountLabel(station) {
  const current = station?.bound && station.quality === 'fresh' && ['working', 'idle'].includes(station.status) ? concurrencyValue(station.concurrency) : null;
  return current === null ? '—' : current;
}
/** Compact employee summary only; technical activity and wire fields are unchanged. */
export function workLabel(station) {
  return !station?.bound || station.status === 'unbound' ? '未绑定' : `${usernameLabel(station)}：${workCountLabel(station)}`;
}
export function statistics(snapshot) {
  const stats = { bound: 0, working: 0, idle: 0, unknown: 0 };
  for (const s of snapshot.stations) if (s.bound) { stats.bound++; stats[s.status === 'working' || s.status === 'idle' ? s.status : 'unknown']++; }
  return stats;
}
export function failedSnapshot(previous, now = Date.now()) { return publicSnapshot(previous, { now, failed: true }); }
export function validateBindings(bindings) {
  if (!Array.isArray(bindings)) return '工位绑定格式无效';
  const seats = new Set();
  for (const binding of bindings) {
    if (!SEAT_IDS.includes(binding.stationId) || seats.has(binding.stationId)) return '工位不存在或重复'; seats.add(binding.stationId);
    if (binding.userId === null) continue;
    if (typeof binding.userId !== 'string' || !binding.userId) return '用户 ID 必须是字符串';
    if (typeof binding.displayName !== 'string' || !binding.displayName.trim() || binding.displayName.length > 40) return '请填写 1–40 字的展示名';
  }
  return null;
}
export function validateDisplay(display) {
  if (!display || !VIEWS.some(([v]) => v === display.default_view)) return '默认视角无效';
  if (!['system', 'on', 'off'].includes(display.reduced_motion)) return '减少动态效果设置无效';
  return ['show_bubbles', 'show_labels', 'details_collapsed'].every(key => typeof display[key] === 'boolean') ? null : '显示设置必须使用布尔值';
}

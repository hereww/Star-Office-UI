/** Version-one wire mapping. Sensitive admin decoding is intentionally a separate module. */
import { SEAT_IDS, concurrencyValue, publicSnapshot, safeAppearance, safeDisplay, safeRoomCharacters } from './model.mjs';
export { safeDisplay } from './model.mjs';
export function decodeSnapshot(wire, { now = Date.now() } = {}) {
  if (wire?.schema_version !== 1 || !Array.isArray(wire.stations) || wire.stations.length !== 16) throw new Error('Invalid snapshot');
  const seen = new Set();
  const stations = wire.stations.map(s => {
    if (!SEAT_IDS.includes(s?.seat_id) || seen.has(s.seat_id) || typeof s.bound !== 'boolean') throw new Error('Invalid seat'); seen.add(s.seat_id);
    const q = typeof s.quality === 'string' ? s.quality : s.quality?.concurrency;
    const quality = ['fresh', 'unavailable', 'untracked', 'stale'].includes(q) ? q : 'unavailable';
    return { stationId: s.seat_id, bound: s.bound, displayName: typeof s.display_name === 'string' ? s.display_name.slice(0, 40) : '工位', status: ['busy', 'idle'].includes(s.activity) ? s.activity === 'busy' ? 'working' : 'idle' : s.bound ? 'unknown' : 'unbound', quality,
      concurrency: quality === 'fresh' ? concurrencyValue(s.concurrency?.current) : null, limit: concurrencyValue(s.concurrency?.limit), observedAt: typeof s.observed_at === 'string' ? s.observed_at : null,
      username: typeof s.username === 'string' ? s.username : null, todayUsage: s.today_usage, activeModels: s.active_models,
      identityQuality: ['fresh', 'unavailable', 'stale', 'unbound'].includes(s.identity_quality) ? s.identity_quality : 'unavailable',
      identityObservedAt: typeof s.identity_observed_at === 'string' ? s.identity_observed_at : null, characterProfileId: typeof s.character_profile_id === 'string' ? s.character_profile_id : null, characterLabel: typeof s.character_label === 'string' ? s.character_label : null, characterStatus: typeof s.character_status === 'string' ? s.character_status : null };
  });
  const snapshot=publicSnapshot({ configVersion: wire.config_version, generatedAt: typeof wire.generated_at === 'string' ? wire.generated_at : null, lastAttemptAt: typeof wire.source?.last_attempt_at === 'string' ? wire.source.last_attempt_at : null, sampledAt: typeof wire.source?.last_success_at === 'string' ? wire.source.last_success_at : null, sourceOK: wire.source?.status === 'ok', sourceStatus: ['ok', 'error', 'stale', 'connecting'].includes(wire.source?.status) ? wire.source.status : 'error', appearance: safeAppearance(wire.appearance),
    pollInterval: [5, 10, 30].includes(wire.source?.poll_interval_seconds) ? wire.source.poll_interval_seconds : 5, display: safeDisplay(wire.display), roomCharacters: safeRoomCharacters(wire.room_characters), stations }, { now });
  const cabinetState=['cabinet_state','service_status','server_status','rack_state'].find(key=>typeof wire.source?.[key]==='string'&&wire.source[key].length<=32);
  return cabinetState ? {...snapshot,cabinetState:wire.source[cabinetState]} : snapshot;
}
/** Reconstructed whitelist wire for runtime: no response object reaches map unchanged. */
export function toRuntimeSnapshot(input, { now = Date.now() } = {}) {
  const snapshot = publicSnapshot(input, { now });
  const cabinetState=typeof input?.cabinetState==='string'&&input.cabinetState.length<=32?input.cabinetState:null;
  return { schema_version: 1, config_version: snapshot.configVersion ?? 0, generated_at: snapshot.generatedAt ?? snapshot.sampledAt, source: { status: snapshot.sourceStatus, last_success_at: snapshot.sampledAt, last_attempt_at: snapshot.lastAttemptAt ?? snapshot.sampledAt, poll_interval_seconds: snapshot.pollInterval || 5, stale_after_seconds: (snapshot.pollInterval || 5) * 3, error_code: null, ...(cabinetState ? { cabinet_state: cabinetState } : {}) },
    display: safeDisplay(snapshot.display), appearance: safeAppearance(snapshot.appearance), room_characters: safeRoomCharacters(snapshot.roomCharacters), summary: { bound: snapshot.stations.filter(s => s.bound).length, busy: snapshot.stations.filter(s => s.status === 'working').length, idle: snapshot.stations.filter(s => s.status === 'idle').length, unknown: snapshot.stations.filter(s => s.status === 'unknown').length }, stations: snapshot.stations.map(s => ({ seat_id: s.stationId, display_name: s.displayName, bound: s.bound, username: s.username, identity_quality: s.identityQuality, identity_observed_at: s.identityObservedAt, activity: s.status === 'working' ? 'busy' : s.status, animation_state: s.status === 'working' ? 'writing' : s.status === 'idle' ? 'idle' : null, concurrency: { current: s.concurrency, limit: s.limit ?? null }, quality: s.status === 'unknown' ? 'unavailable' : s.quality || 'unavailable', observed_at: s.observedAt ?? null, data_age_seconds: null, reason: s.status === 'unknown' ? 'unavailable' : null, character_profile_id: s.characterProfileId || snapshot.appearance.character_profile_id, character_label: s.characterLabel, character_status: s.characterStatus })) };
}
export const officeCodec = { decodeSnapshot };

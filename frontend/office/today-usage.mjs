/** Fullscreen HUD's only public usage field. No numeric coercion or private metadata. */
export function beijingDate(now = Date.now()) {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function safeTodayUsage(value, { now = Date.now(), sourceOK = false, bound = false, staleMs = 15000 } = {}) {
  const date = beijingDate(now);
  const empty = { total: null, date, timezone: 'Asia/Shanghai', quality: bound ? 'unavailable' : 'unbound', observed_at: null, window_end: null };
  if (!sourceOK || !bound || !value) return empty;
  const observed = typeof value.observed_at === 'string' ? Date.parse(value.observed_at) : NaN;
  const end = typeof value.window_end === 'string' ? Date.parse(value.window_end) : NaN;
  const recent = stamp => Number.isFinite(stamp) && stamp <= now + 5000 && now - stamp < staleMs && beijingDate(stamp) === date;
  if (value.date !== date || value.timezone !== 'Asia/Shanghai' || value.quality === 'stale') return { ...empty, quality: 'stale' };
  if (value.quality !== 'fresh' || typeof value.total !== 'string' || !/^(0|[1-9]\d*)$/.test(value.total)) return empty;
  if (!recent(observed) || !recent(end)) return { ...empty, quality: 'stale' };
  return { total: value.total, date, timezone: 'Asia/Shanghai', quality: 'fresh', observed_at: value.observed_at, window_end: value.window_end };
}
export function exactTokenLabel(value) {
  if (value?.quality !== 'fresh' || typeof value.total !== 'string' || !/^(0|[1-9]\d*)$/.test(value.total)) return '未知';
  return value.total.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

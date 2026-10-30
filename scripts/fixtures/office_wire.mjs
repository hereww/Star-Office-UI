/** Synthetic public Office payload; never includes real identities or secrets. */
export function wireSnapshot({ now = Date.now(), current = 2, status = 'ok', quality = 'fresh', observedAt = new Date(now).toISOString() } = {}) {
  return {
    schema_version: 1, config_version: 1, generated_at: new Date(now).toISOString(),
    source: { status, last_success_at: new Date(now).toISOString(), last_attempt_at: new Date(now).toISOString(), poll_interval_seconds: 5, stale_after_seconds: 15, error_code: null },
    display: { default_view: 'overview', show_bubbles: true, show_labels: true, details_collapsed: false, reduced_motion: 'system' },
    appearance: { character_profile_id: 'orange-cat-v1', allow_fallback: false },
    stations: Array.from({ length: 16 }, (_, i) => {
      const seat_id = `desk-${String(i + 1).padStart(2, '0')}`;
      const bound = seat_id === 'desk-12';
      return {
        seat_id, bound, display_name: bound ? '主工位' : '空工位',
        activity: !bound ? 'unbound' : quality === 'fresh' && current !== null && status === 'ok' ? current === 0 ? 'idle' : 'busy' : 'unknown',
        animation_state: !bound ? null : current === 0 ? 'idle' : 'writing',
        concurrency: { current: bound ? current : null, limit: null },
        quality: bound ? quality : 'unbound', observed_at: bound ? observedAt : null,
      };
    }),
  };
}

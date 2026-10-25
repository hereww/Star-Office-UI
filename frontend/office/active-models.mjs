/** Current forwarding requests only; never infer a model from completed usage. */
const validName = value => typeof value === 'string' && value.length > 0 && value.length <= 200
  && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value);
const requestCount = value => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && (value.length < 19 || value <= '9223372036854775807')
  ? value : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : null;

export function safeActiveModels(value, { now = Date.now(), bound = false, sourceOK = false, sourceStatus = 'error', staleMs = 15_000 } = {}) {
  const empty = { models: [], quality: bound ? 'unavailable' : 'unbound', observed_at: null };
  if (!bound) return empty;
  if (!sourceOK) return { ...empty, quality: sourceStatus === 'stale' ? 'stale' : 'unavailable' };
  if (value?.quality === 'stale') return { ...empty, quality: 'stale' };
  if (!['fresh', 'partial'].includes(value?.quality) || !Array.isArray(value.models) || value.models.length > 10000) return empty;
  const observed = typeof value.observed_at === 'string' ? Date.parse(value.observed_at) : NaN;
  if (!Number.isFinite(observed)) return empty;
  if (observed > now || now - observed >= staleMs) return { ...empty, quality: 'stale' };
  const models = [];
  for (const row of value.models) {
    const count = requestCount(row?.requests);
    if (!validName(row?.requested_model) || (row?.upstream_model !== null && !validName(row?.upstream_model)) || count === null) return empty;
    models.push({ requested_model: row.requested_model, upstream_model: row.upstream_model, requests: count });
  }
  return { models, quality: value.quality, observed_at: value.observed_at };
}

export function activeModelsLabel(station) {
  if (!station?.bound) return '未绑定';
  const value = station.activeModels;
  if (value?.quality === 'stale') return '已过期';
  if (!['fresh', 'partial'].includes(value?.quality)) return '未知';
  if (!value.models.length) return station.quality === 'fresh' && /^0+$/.test(station.concurrency ?? '') ? '暂无活跃模型' : '暂未识别';
  return value.models.map(row => {
    const name = row.upstream_model && row.upstream_model !== row.requested_model
      ? `${row.requested_model} → ${row.upstream_model}` : row.requested_model;
    return row.requests === '1' ? name : `${name} × ${row.requests}`;
  }).join('\n');
}

export function activeModelsDescription(station) {
  const label = activeModelsLabel(station);
  const value = station?.activeModels;
  if (!['fresh', 'partial'].includes(value?.quality)) return label;
  return `${label}\n采样时正在处理的请求；× 表示该模型的请求数。${value.quality === 'partial' ? '当前数据源覆盖部分请求链路。' : ''}`;
}

export class OfficeError extends Error {
  constructor(code, status = 0) { super(code); this.name = 'OfficeError'; this.code = code; this.status = status; }
}
export function errorMessage(error) {
  if (error?.status === 401) return '登录已失效，请重新登录。';
  if (error?.status === 403) return '请求未获授权或安全校验未通过。';
  if (error?.status === 409) return '配置已被其他管理员修改。请保留草稿，重新读取后再编辑。';
  if (error?.status === 429) return '操作过于频繁，请稍后再试。';
  if (error?.code === 'codec') return '接口协议待接入；当前不能读取或保存真实配置。';
  if (error?.code === 'readback') return '保存响应未完成读回确认。请重新读取服务端配置，不要重复提交。';
  if (error?.code === 'write_unconfirmed') return '保存或恢复结果未确认，请先重新读取服务端版本，不要重复提交。';
  return '服务暂时不可用，请检查连接并重新读取服务端状态。';
}
const ROUTES = Object.freeze({ snapshot: '/api/office/snapshot', characterProfiles: '/api/office/character-profiles', session: '/api/office/admin/session', users: '/api/office/admin/users', config: '/api/office/admin/config', restore: '/api/office/admin/config/restore' });
export class OfficeAPI {
  constructor({ codec = null, fetchImpl = globalThis.fetch, origin = globalThis.location?.origin } = {}) { this.codec = codec; this.fetchImpl = (...args) => fetchImpl(...args); this.origin = origin; this.controllers = new Set(); }
  async request(resource, { method = 'GET', body, csrfToken, signal } = {}) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8_000);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort(); this.controllers.add(controller);
    try {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
      const response = await this.fetchImpl(new URL(ROUTES[resource], this.origin), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (!response.ok) throw new OfficeError('http', response.status);
      if (response.status === 204) return null;
      return await response.json();
    } catch (error) { if (error instanceof OfficeError) throw error; throw new OfficeError('network'); }
    finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); this.controllers.delete(controller); }
  }
  decode(name, payload) { if (typeof this.codec?.[name] !== 'function') throw new OfficeError('codec'); return this.codec[name](payload); }
  encode(name, ...args) { if (typeof this.codec?.[name] !== 'function') throw new OfficeError('codec'); return this.codec[name](...args); }
  async snapshot(signal) { return this.decode('decodeSnapshot', await this.request('snapshot', { signal })); }
  async characterProfiles() { return await this.request('characterProfiles'); }
  async session() { return this.decode('decodeSession', await this.request('session')); }
  async users() { return this.decode('decodeAdminUsers', await this.request('users')); }
  async config() { return this.decode('decodeConfig', await this.request('config')); }
  async login(password, session, username = 'admin') { const encoded = this.encode('encodeLogin', { password, username }, session); return this.decode('decodeSession', await this.request('session', { ...encoded, method: 'POST' })); }
  async logout(session) { const encoded = this.encode('encodeLogout', session); await this.request('session', { ...encoded, method: 'DELETE' }); }
  async save(draft, version, session) {
    const encoded = this.encode('encodeSaveConfig', draft, version, session);
    let saved;
    try { saved = this.decode('decodeConfig', await this.request('config', { ...encoded, method: 'PUT' })); }
    catch (error) { if (error?.status || error?.code === 'codec') throw error; throw new OfficeError('write_unconfirmed'); }
    try { const confirmed = await this.config(); if (confirmed.version <= version || !this.codec.sameSavedConfig(saved.config, confirmed.config)) throw new OfficeError('readback'); return confirmed; }
    catch (error) { if (error?.status === 401 || error?.status === 403) throw error; throw new OfficeError('readback'); }
  }
  async restore(version, currentVersion, session) {
    const encoded = this.encode('encodeRestoreConfig', version, currentVersion, session);
    let saved;
    try { saved = this.decode('decodeConfig', await this.request('restore', { ...encoded, method: 'POST' })); }
    catch (error) { if (error?.status || error?.code === 'codec') throw error; throw new OfficeError('write_unconfirmed'); }
    try { const confirmed = await this.config(); if (confirmed.version <= currentVersion || !this.codec.sameSavedConfig(saved.config, confirmed.config)) throw new OfficeError('readback'); return confirmed; }
    catch (error) { if (error?.status === 401 || error?.status === 403) throw error; throw new OfficeError('readback'); }
  }
  dispose() { for (const controller of this.controllers) controller.abort(); this.controllers.clear(); }
}
/** Fixed two-second local cadence; no overlap or calls to any upstream provider. */
export function pollSnapshot(api, onSnapshot, onFailure, { interval = 2_000, scheduler = globalThis } = {}) {
  let stopped = false, busy = false; const abort = new AbortController();
  const tick = async () => {
    if (stopped || busy) return; busy = true;
    try { const result = await api.snapshot(abort.signal); if (!stopped) onSnapshot(result); }
    catch (error) { if (!stopped) onFailure(error); }
    finally { busy = false; }
  };
  const timer = scheduler.setInterval(tick, interval); void tick();
  return () => { stopped = true; abort.abort(); scheduler.clearInterval(timer); };
}

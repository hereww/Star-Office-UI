import { officeCodec } from './codec.mjs';
import { DEFAULT_CHARACTER_PROFILE_ID, decimalString, safeAppearance, safeRoomCharacters } from './model.mjs';
const clone = input => structuredClone(input);
export const configContent = config => ({ bindings: config.bindings, display: config.display, collection: config.collection, appearance: safeAppearance(config.appearance), room_characters: safeRoomCharacters(config.room_characters) });
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])); return value; }
export function sameSavedConfig(a, b) { return a?.version === b?.version && JSON.stringify(stable(a)) === JSON.stringify(stable(b)); }
export const adminCodec = {
  ...officeCodec,
  decodeSession(wire) { if (typeof wire?.authenticated !== 'boolean' || typeof wire.csrf_token !== 'string') throw new Error('Invalid session'); return { authenticated: wire.authenticated, csrfToken: wire.csrf_token, username: typeof wire.username === 'string' ? wire.username : null }; },
  decodeConfig(wire) { const config = wire?.config; if (!Number.isSafeInteger(config?.version) || config.schema_version !== 1 || !Array.isArray(config.bindings) || !config.display || !config.collection) throw new Error('Invalid config'); for (const row of config.bindings) if (!decimalString(row.user_id)) throw new Error('Invalid user ID'); const normalized = { ...clone(config), appearance: safeAppearance(config.appearance || { character_profile_id: DEFAULT_CHARACTER_PROFILE_ID }), room_characters: safeRoomCharacters(config.room_characters) }; return { config: normalized, version: config.version, history: Array.isArray(wire.history) ? clone(wire.history) : [] }; },
  decodeAdminUsers(wire) {
    if (wire?.schema_version !== 1 || !Array.isArray(wire.users)) throw new Error('Invalid users');
    for (const row of wire.users) { if (!decimalString(row.user_id) || (row.token_usage?.total != null && !decimalString(row.token_usage.total))) throw new Error('Lossy user/usage'); for (const key of row.api_keys || []) if (!decimalString(key.id)) throw new Error('Lossy key ID'); }
    return clone(wire);
  },
  encodeLogin({ password, username = 'admin' }, session) { return { body: { username, password }, csrfToken: session?.csrfToken }; },
  encodeLogout(session) { return { csrfToken: session?.csrfToken }; },
  encodeSaveConfig(draft, version, session) { return { body: { expected_version: version, config: configContent(draft) }, csrfToken: session?.csrfToken }; },
  encodeRestoreConfig(target, version, session) { return { body: { expected_version: version, target_version: target }, csrfToken: session?.csrfToken }; },
  sameSavedConfig,
};

/** UI metadata follows the plugin's four independently observed field groups.
 * Identity quality covers BOTH username and email; never infer from their values.
 */
export function privateTelemetryMetadata(user) {
  const timestamp = user?.observed_at?.concurrency;
  const labels = { fresh: '可信', unavailable: '不可用', untracked: '未跟踪', stale: '过期' };
  const groups = [['username', '用户名', 'identity'], ['email', '邮箱', 'identity'], ['api_keys', 'Key 元数据', 'api_keys'], ['token_usage', '已入库用量', 'token_usage'], ['concurrency', '当前并发', 'concurrency']];
  return {
    lastObservedAt: typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp)) ? timestamp : null,
    qualities: groups.map(([field, label, source]) => {
      const raw = user?.quality?.[source], code = typeof raw === 'string' ? raw : null;
      return { field, label, source, code, text: code === null ? '未知' : `${Object.hasOwn(labels, code) ? labels[code] : '未知'}（${code}）` };
    }),
  };
}

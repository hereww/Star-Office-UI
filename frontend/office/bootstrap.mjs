/** release_prefix is the server's versioned STATIC ROOT, not the office directory. */
export function readBootConfig(document = globalThis.document, boot = globalThis.window?.__OFFICE_BOOT__ || {}) {
  const base = boot.release_prefix ? new URL(`${boot.release_prefix.replace(/\/$/, '')}/office/`, document.baseURI) : new URL('./', document.baseURI);
  if (base.origin !== new URL(document.baseURI).origin) throw new Error('资源基址必须同源');
  return Object.freeze({ ...boot, releasePrefix: base.href, mode: boot.mode === 'admin' ? 'admin' : 'employee' });
}
export async function boot() {
  try {
    const config = readBootConfig();
    const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = new URL('office.css', config.releasePrefix).href; document.head.append(stylesheet);
    const { startOfficeApp } = await import(new URL('app.mjs', config.releasePrefix)); await startOfficeApp(config);
  } catch {
    const root = document.getElementById('office-app'); root.textContent = '办公室暂时无法加载。请检查同源版本资源配置后刷新。'; root.setAttribute('role', 'alert');
  }
}

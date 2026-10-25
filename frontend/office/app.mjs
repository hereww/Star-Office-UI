import { OfficeAPI } from './transport.mjs';
import { officeCodec } from './codec.mjs';
export async function startOfficeApp(config) {
  const codec = config.mode === 'admin' ? (await import('./admin-codec.mjs')).adminCodec : officeCodec;
  const api = new OfficeAPI({ codec });
  const module = await import(config.mode === 'admin' ? './admin.mjs' : './employee.mjs');
  const cleanup = await module.mount(document.getElementById('office-app'), config, api);
  const dispose = () => { cleanup?.(); api.dispose(); };
  window.addEventListener('pagehide', dispose, { once: true }); return dispose;
}

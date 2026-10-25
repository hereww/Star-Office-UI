import { workLabel } from './model.mjs';
/** Text is always a text node, never HTML. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'checked' || key === 'disabled' || key === 'hidden') node[key] = Boolean(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined) node.append(typeof child === 'object' ? child : document.createTextNode(String(child)));
  return node;
}
export const button = (text, handler, attrs = {}) => el('button', { type: 'button', onclick: handler, ...attrs }, text);
export function field(label, input, hint) {
  const id = input.id || `office-field-${++field.sequence}`; input.id = id;
  return el('div', { class: 'field' }, el('label', { for: id }, label), input, hint ? el('small', {}, hint) : null);
}
field.sequence = 0;
export function setNotice(node, text, kind = 'info') { node.textContent = text; node.dataset.kind = kind; node.hidden = !text; }
export function formatTime(value) {
  const date = new Date(value); if (!value || !Number.isFinite(+date)) return '尚无采样';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
}
export function labelledValue(label, value) { return el('div', { class: 'data-pair' }, el('dt', {}, label), el('dd', {}, value ?? '未知')); }
export function statusBadge(status, { label: overrideLabel } = {}) {
  const labels = { working: ['↗', '处理中'], idle: ['○', '待命'], unknown: ['?', '状态未知'], unbound: ['—', '未绑定'] };
  const [icon, label] = labels[status] || labels.unknown;
  return el('span', { class: `status-badge ${Object.hasOwn(labels, status) ? status : 'unknown'}` }, el('span', { 'aria-hidden': 'true' }, icon), overrideLabel ?? label);
}
export function workBadge(station) { return statusBadge(station?.status, { label: workLabel(station) }); }
export function makeDialog(title) {
  const dialog = el('dialog', { class: 'confirm-dialog', 'data-testid': 'config-dialog', 'aria-label': title });
  document.body.append(dialog); return dialog;
}
/** Boolean deployment label only; this never imports or generates fixture data. */
export function fixtureBanner() { return el('div', { class: 'preview-fixture-banner', 'data-testid': 'isolation-fixture-banner', role: 'note' }, el('strong', {}, '隔离验收 · 模拟遥测数据'), el('span', {}, '非生产环境 · 请勿作为线上运行证据')); }

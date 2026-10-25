const DEMO_STATUS = Object.freeze({
  idle: '演示·待机',
  writing: '演示·写作',
  researching: '演示·研究',
  executing: '演示·执行',
  syncing: '演示·同步',
  error: '演示·异常',
});

/**
 * Return a short, identity-free status without mutating the station.
 * Demo states are illustrative; only fresh, bound telemetry can imply activity.
 * Decimal counts stay strings (including leading zeroes and arbitrarily large values).
 */
export function speechBubbleStatus(station) {
  if (!station || typeof station !== 'object' || Array.isArray(station)) {
    return '状态未知';
  }

  if (station.source === 'demo') {
    return typeof station.state === 'string' && Object.hasOwn(DEMO_STATUS, station.state)
      ? DEMO_STATUS[station.state]
      : '演示·状态未知';
  }
  if (station.source === 'unbound') return '未绑定';
  if (station.source !== 'telemetry') return '状态未知';
  if (station.bound === false) return '未绑定';
  if (station.bound !== true) return '状态未知';

  switch (station.quality) {
    case 'untracked': return '未跟踪';
    case 'stale': return '已过期';
    case 'unavailable': return '状态未知';
    case 'fresh': break;
    default: return '状态未知';
  }

  const current = station.current;
  // Reject coercion, signs, fractions, whitespace, exponents and non-ASCII digits.
  if (typeof current !== 'string' || current.length === 0 || /[^0-9]/u.test(current)) {
    return '状态未知';
  }
  const count = current.replace(/^0+/u, '') || '0';
  if (count.length > 1 || count === '9') return '狂暴模式';
  if (count === '0') return '休息中';
  if (count === '1' || count === '2') return '工作中';
  if (count === '3' || count === '4') return '忙碌中';
  return '玩命干活中';
}

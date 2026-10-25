import { el } from './dom.mjs';
import { usernameLabel, workCountLabel } from './model.mjs';
import { speechBubbleStatus } from './bubble-status.mjs';
import { exactTokenLabel } from './today-usage.mjs';
import { activeModelsLabel, activeModelsDescription } from './active-models.mjs';
import { characterPortraitUrl } from '../company-office/character-profile-runtime.mjs';

const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };

/** Read-only party roster. Never selects, focuses, writes state, or fetches upstream. */
export function createFullscreenHud() {
  const count = el('span', { class: 'hud-member-count' });
  const list = el('ul', { class: 'hud-roster', 'data-testid': 'hud-roster' });
  const element = el('section', { class: 'fullscreen-hud', 'data-testid': 'fullscreen-hud', 'aria-label': '角色状态信息' },
    el('header', { class: 'hud-header' }, el('div', {}, el('span', { class: 'hud-eyebrow', 'aria-hidden': 'true' }, 'OFFICE PARTY'), el('h2', {}, '角色状态')), count), list);
  const cards = new Map();
  function makeCard(id) {
    const name = el('h3', { class: 'hud-name', 'data-testid': 'hud-username' });
    const state = el('span', { class: 'hud-state', 'data-testid': 'hud-status' });
    const models = el('dd', { class: 'hud-model-value', 'data-testid': 'hud-models' });
    const conversations = el('dd', { 'data-testid': 'hud-conversations' });
    const tokens = el('dd', { class: 'hud-token-value', 'data-testid': 'hud-tokens' });
    const portrait = el('img', { src: characterPortraitUrl(), alt: '', draggable: 'false', width: 192, height: 192, 'data-character-profile-id': 'orange-cat-v1' });
    const node = el('li', { class: 'hud-card', 'data-seat-id': id },
      el('div', { class: 'hud-identity' }, el('div', { class: 'hud-portrait', 'aria-hidden': 'true' }, portrait),
        el('div', { class: 'hud-person' }, name, state)),
      el('dl', { class: 'hud-model' }, el('dt', {}, '当前模型'), models),
      el('dl', { class: 'hud-metrics' }, el('div', {}, el('dt', {}, '对话数'), conversations), el('div', { class: 'hud-token-metric' }, el('dt', {}, '今日消耗 Token'), tokens)));
    return { node, name, state, models, conversations, tokens, portrait };
  }
  function update(snapshot, selected) {
    const stations = snapshot.stations.filter(s => s.bound);
    const ids = new Set(stations.map(s => s.stationId));
    for (const [id, card] of cards) if (!ids.has(id)) { card.node.remove(); cards.delete(id); }
    for (const station of stations) {
      let card = cards.get(station.stationId);
      if (!card) { card = makeCard(station.stationId); cards.set(station.stationId, card); }
      // Reconcile without replacing nodes: polling must not reset horizontal or
      // vertical scrolling or repeatedly announce the whole roster to AT.
      const index = stations.indexOf(station);
      if (list.children[index] !== card.node) list.insertBefore(card.node, list.children[index] ?? null);
      card.node.dataset.activity = station.status;
      card.node.classList.toggle('is-selected', station.stationId === selected);
      const profileId = station.characterProfileId;
      const portraitUrl = characterPortraitUrl(profileId);
      if (card.portrait.dataset.characterProfileId !== (profileId || 'orange-cat-v1')) card.portrait.dataset.characterProfileId = profileId || 'orange-cat-v1';
      if (card.portrait.src !== portraitUrl) card.portrait.src = portraitUrl;
      setText(card.name, usernameLabel(station));
      setText(card.state, speechBubbleStatus({ source: 'telemetry', bound: true, quality: station.quality, current: station.concurrency }));
      setText(card.models, activeModelsLabel(station));
      card.models.dataset.quality = station.activeModels?.quality ?? 'unavailable';
      card.models.title = activeModelsDescription(station);
      setText(card.conversations, workCountLabel(station));
      setText(card.tokens, exactTokenLabel(station.todayUsage));
      card.tokens.dataset.quality = station.todayUsage?.quality ?? 'unavailable';
      card.tokens.title = station.todayUsage?.quality === 'fresh'
        ? `${station.todayUsage.date} · 北京时间 00:00 起，截至 ${station.todayUsage.window_end} 已入库总量：${station.todayUsage.total}`
        : '暂无可信的今日用量；不以零替代';
    }
    setText(count, `${stations.length} 位成员`);
    element.dataset.empty = String(!stations.length);
  }
  return { element, update };
}

import { initLocale, t } from '../shared/platform/locale.js';
import { api } from '../shared/platform/bridge.js';
import { getConfig } from '../shared/platform/storage.js';

async function render() {
  await initLocale();
  const cfg = await getConfig();
  document.documentElement.dataset.theme = cfg.theme || 'system';
  const res = await api.ping();
  document.getElementById('app').innerHTML = `
    <h1 style="font-size:var(--font-lg)">${t('app.name')}</h1>
    <p class="empty">${t('list.empty')} · ${res.ok ? 'SW ready' : 'SW unavailable'}</p>
  `;
}
render();

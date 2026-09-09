import { initLocale, t, onLocaleChanged } from '../shared/platform/locale.js';
import { getConfig } from '../shared/platform/storage.js';
import { api } from '../shared/platform/bridge.js';

async function render() {
  const cfg = await getConfig();
  document.documentElement.dataset.theme = cfg.theme || 'system';
  document.getElementById('app').innerHTML = `
    <h1 style="font-size:var(--font-lg)">${t('nav.settings')}</h1>
    <p style="color:var(--text-muted)">${t('settings.groupAppearance')}: ${t('settings.theme')} = ${cfg.theme}</p>
  `;
}
await initLocale();
render();
onLocaleChanged(render);
void api;

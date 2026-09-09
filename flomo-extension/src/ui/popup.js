// Popup：未登录 → 内嵌登录表单；已登录 → 显示速记框（登录态由后台判定后分流）。
import { initLocale, t } from '../shared/platform/locale.js';
import { api, call } from '../shared/platform/bridge.js';
import { getConfig } from '../shared/platform/storage.js';
import { mountLoginForm } from './login.js';

const app = document.getElementById('app');

async function render() {
  await initLocale();
  const cfg = await getConfig();
  document.documentElement.dataset.theme = cfg.theme || 'system';

  const status = await call('auth_status');
  if (status.ok && status.data.loggedIn) {
    renderCompose(status.data.user, cfg);
  } else {
    renderLogin();
  }
}

function renderLogin() {
  app.innerHTML = '';
  mountLoginForm(app, {
    onSuccess: () => {
      app.innerHTML = `<p class="empty">${t('login.success')}</p>`;
      setTimeout(() => window.close(), 400);
    },
  });
}

function renderCompose(user, cfg) {
  app.innerHTML = `
    <div class="row-between">
      <span class="muted">${user?.nickname || user?.email || t('app.name')}</span>
      <button class="btn btn-ghost" id="openSide">${t('nav.history')}</button>
    </div>
    <textarea id="text" class="textarea" placeholder="${t('capture.placeholder')}" rows="6"></textarea>
    <p class="hint">Ctrl/Cmd + Enter ${t('common.save')}</p>
    <p id="error" class="error" hidden></p>
    <div class="row-end">
      <button class="btn btn-primary" id="save" disabled>${t('common.save')}</button>
    </div>
    <p class="hint">${t('settings.syncInterval')}: ${cfg.syncIntervalMinutes}m</p>
  `;

  const textEl = app.querySelector('#text');
  const saveBtn = app.querySelector('#save');
  const errEl = app.querySelector('#error');

  // 空内容禁用保存（trim 后长度 0）
  const sync = () => {
    saveBtn.disabled = textEl.value.trim().length === 0;
  };
  textEl.addEventListener('input', sync);
  textEl.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') doSave();
  });
  saveBtn.addEventListener('click', doSave);
  app.querySelector('#openSide').addEventListener('click', async () => {
    const tab = await new Promise((r) => chrome.tabs?.query?.({ active: true, currentWindow: true }, (t) => r(t?.[0])));
    if (tab?.windowId != null && chrome.sidePanel?.open) chrome.sidePanel.open({ windowId: tab.windowId });
    else chrome.runtime.openOptionsPage();
  });

  async function doSave() {
    if (textEl.value.trim().length === 0) return;
    saveBtn.disabled = true;
    errEl.hidden = true;
    const res = await call('memo_create', { text: textEl.value });
    if (res.ok) {
      textEl.value = '';
      window.close();
      return;
    }
    errEl.textContent = res.message || t('error.unknown');
    errEl.hidden = false;
    saveBtn.disabled = false;
  }

  textEl.focus();
  sync();
}

render();
void api;

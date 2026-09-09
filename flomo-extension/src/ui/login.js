// 独立标签页登录页（失效重登场景）。Popup 内嵌登录复用这里导出的 mountLoginForm。
import { initLocale, t } from '../shared/platform/locale.js';
import { getConfig } from '../shared/platform/storage.js';
import { call } from '../shared/platform/bridge.js';
import { ERROR_CODE } from '../shared/core/constants.js';

/** 把错误码转成文案键（服务端原文透传优先，本地文案只作兜底） */
function messageFor(result) {
  if (result?.message) return result.message; // 服务端原文，不翻译不改写
  switch (result?.error) {
    case ERROR_CODE.NOT_AUTHENTICATED:
      return t('error.notAuthenticated');
    case ERROR_CODE.TIMEOUT:
      return t('error.timeout');
    case ERROR_CODE.NETWORK_ERROR:
      return t('error.network');
    case ERROR_CODE.RATE_LIMITED:
      return t('error.rateLimited');
    case ERROR_CODE.CONTRACT_CHANGED:
      return t('error.contractChanged');
    default:
      return t('error.unknown');
  }
}

export function mountLoginForm(root, { onSuccess } = {}) {
  root.innerHTML = `
    <h1 class="login-title">${t('login.title')}</h1>
    <form id="login-form" autocomplete="on">
      <label class="field">
        <span class="field-label">${t('login.email')}</span>
        <input id="email" type="email" class="input" placeholder="${t('login.emailPlaceholder')}" autocomplete="username" required />
      </label>
      <label class="field">
        <span class="field-label">${t('login.password')}</span>
        <input id="password" type="password" class="input" placeholder="${t('login.passwordPlaceholder')}" autocomplete="current-password" required />
      </label>
      <p class="hint">${t('login.hintSafe')}</p>
      <p id="error" class="error" role="alert" hidden></p>
      <button id="submit" type="submit" class="btn btn-primary btn-block">${t('login.submit')}</button>
      <p class="hint">${t('login.hint')}</p>
    </form>
  `;

  const form = root.querySelector('#login-form');
  const emailEl = root.querySelector('#email');
  const pwEl = root.querySelector('#password');
  const errEl = root.querySelector('#error');
  const btn = root.querySelector('#submit');

  function showError(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
  }
  function setLoading(loading) {
    btn.disabled = loading;
    btn.textContent = loading ? t('login.loggingIn') : t('login.submit');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.hidden = true;

    // 前端只做空值校验，格式交给服务端判定
    const email = emailEl.value.trim();
    const password = pwEl.value;
    if (!email) return showError(t('login.emailRequired'));
    if (!password) return showError(t('login.passwordRequired'));

    setLoading(true);
    const res = await call('auth_login', { email, password });
    setLoading(false);

    if (res.ok) {
      onSuccess?.(res.data);
      return;
    }
    showError(messageFor(res));
  });

  emailEl.focus();
}

// 独立标签页：挂载后登录成功即关闭自身
const cfg = await getConfig();
document.documentElement.dataset.theme = cfg.theme || 'system';
await initLocale();
mountLoginForm(document.getElementById('app'), {
  onSuccess: () => {
    // 登录成功后关闭标签页，回到扩展主界面
    setTimeout(() => window.close(), 300);
  },
});

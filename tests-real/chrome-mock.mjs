// 沙盒内无真实浏览器（且唯一可获取的 Chromium 被裁剪掉扩展与 WebUI 支持），
// 因此用「内存版 chrome API」驱动**真实源码**运行：跑的是 src/ 下的原文件，不是替身。
// 覆盖：storage（含 onChanged 真实广播）、runtime 消息路由、alarms、contextMenus、sidePanel、notifications。
// 不覆盖：CORS、SW 生命周期、真实网络 —— 这些只能真机验证。

export function createChromeMock() {
  const store = new Map();
  const listeners = {
    'storage.onChanged': [],
    'runtime.onMessage': [],
    'runtime.onInstalled': [],
    'runtime.onStartup': [],
    'alarms.onAlarm': [],
    'contextMenus.onClicked': [],
  };

  const calls = [];
  const record = (name, args) => calls.push({ name, args });

  const lastError = { value: undefined };

  function emit(key, ...args) {
    for (const fn of listeners[key] || []) fn(...args);
  }

  const storageLocal = {
    get(keys, cb) {
      const k = keys == null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const key of k) if (store.has(key)) out[key] = clone(store.get(key));
      setTimeout(() => cb(out), 0);
    },
    set(obj, cb) {
      const changes = {};
      for (const [key, value] of Object.entries(obj)) {
        changes[key] = { oldValue: store.has(key) ? clone(store.get(key)) : undefined, newValue: clone(value) };
        store.set(key, clone(value));
      }
      record('storage.set', Object.keys(obj));
      setTimeout(() => {
        cb && cb();
        emit('storage.onChanged', changes, 'local');
      }, 0);
    },
    remove(key, cb) {
      const oldValue = store.has(key) ? clone(store.get(key)) : undefined;
      store.delete(key);
      setTimeout(() => {
        cb && cb();
        emit('storage.onChanged', { [key]: { oldValue, newValue: undefined } }, 'local');
      }, 0);
    },
  };

  const chrome = {
    __calls: calls,
    __store: store,
    __emit: emit,
    __storage: storageLocal,

    runtime: {
      get lastError() {
        return lastError.value;
      },
      get id() {
        return 'mock-extension-id';
      },
      getURL: (p) => `chrome-extension://mock-extension-id/${p}`,
      openOptionsPage: () => record('runtime.openOptionsPage', []),
      onInstalled: { addListener: (fn) => listeners['runtime.onInstalled'].push(fn) },
      onStartup: { addListener: (fn) => listeners['runtime.onStartup'].push(fn) },
      onMessage: {
        addListener: (fn) => listeners['runtime.onMessage'].push(fn),
        removeListener: (fn) => {
          const i = listeners['runtime.onMessage'].indexOf(fn);
          if (i >= 0) listeners['runtime.onMessage'].splice(i, 1);
        },
      },
      // 模拟「UI → 后台」的真实往返：同步投递给后台监听器，后台用 sendResponse 异步回包
      sendMessage(msg, cb) {
        record('runtime.sendMessage', [msg?.type]);
        const handlers = listeners['runtime.onMessage'];
        if (!handlers.length) {
          setTimeout(() => cb && cb({ ok: false, error: 'unknown_error', message: 'no listener' }), 0);
          return;
        }
        let responded = false;
        const sendResponse = (res) => {
          if (responded) return;
          responded = true;
          setTimeout(() => cb && cb(res), 0);
        };
        const sender = { id: 'mock-extension-id', tab: { id: 1 } };
        for (const fn of handlers) {
          const keep = fn(msg, sender, sendResponse);
          void keep;
        }
      },
    },

    storage: {
      local: storageLocal,
      onChanged: {
        addListener: (fn) => listeners['storage.onChanged'].push(fn),
        removeListener: (fn) => {
          const i = listeners['storage.onChanged'].indexOf(fn);
          if (i >= 0) listeners['storage.onChanged'].splice(i, 1);
        },
      },
    },

    alarms: {
      _items: new Map(),
      create(name, info) {
        this._items.set(name, { name, periodInMinutes: info?.periodInMinutes, ...info });
        record('alarms.create', [name, info?.periodInMinutes]);
        return Promise.resolve();
      },
      get(name) {
        return Promise.resolve(this._items.get(name));
      },
      clear(name) {
        this._items.delete(name);
        return Promise.resolve();
      },
      onAlarm: { addListener: (fn) => listeners['alarms.onAlarm'].push(fn) },
    },

    contextMenus: {
      _items: [],
      removeAll(cb) {
        this._items = [];
        setTimeout(() => cb && cb(), 0);
      },
      create(props) {
        this._items.push(props);
        record('contextMenus.create', [props.id]);
      },
      onClicked: { addListener: (fn) => listeners['contextMenus.onClicked'].push(fn) },
    },

    sidePanel: {
      _behavior: null,
      setPanelBehavior(opts) {
        this._behavior = opts;
        record('sidePanel.setPanelBehavior', [opts]);
        return Promise.resolve();
      },
    },

    notifications: {
      _sent: [],
      create(opts) {
        this._sent.push(opts);
        record('notifications.create', [opts?.title]);
      },
    },
  };

  return chrome;
}

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

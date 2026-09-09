// Content Script：MV3 声明式注入的是 classic script（不支持 ES module），
// 因此本文件不 import 任何模块；共享逻辑一律走消息或后台。
// P0 阶段只做一件事：读配置 → 命中黑名单则完全不启用（R13-4）。
// 后续 P4：划词浮层挂进 Shadow DOM；配置变更通过 chrome.storage.onChanged 热更新。
(function () {
  if (!chrome.runtime || !chrome.runtime.id) return; // 扩展已重载或失效

  var enabled = false;

  function isBlocked(host, blacklist) {
    return (blacklist || []).some(function (rule) {
      if (!rule) return false;
      if (rule.indexOf('*') === -1) return host === rule || host.endsWith('.' + rule);
      var escaped = rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      try {
        return new RegExp('^' + escaped + '$').test(host);
      } catch (e) {
        return false;
      }
    });
  }

  function apply(cfg) {
    var trigger = (cfg && cfg.captureTrigger) || 'icon';
    var blocked = isBlocked(location.hostname, (cfg && cfg.siteBlacklist) || []);
    enabled = trigger !== 'off' && !blocked;
    if (!enabled) return;
    // TODO(P4)：注册选区监听 → 浮出小图标 / 直弹小框（Shadow DOM 隔离）
  }

  chrome.storage.local.get(['config'], function (res) {
    apply(res && res.config);
  });

  // 配置热更新：content script 收不到 runtime 广播，只能靠 storage.onChanged
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes.config) return;
    apply(changes.config.newValue);
  });
})();

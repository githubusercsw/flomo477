import test from 'node:test';
import assert from 'node:assert/strict';
import { diffDictionaries, translate, lookup, resolveLang, SUPPORTED_LANGS } from '../../src/shared/core/i18n.js';

test('中英字典键集合与占位符完全一致（防漏译）', () => {
  assert.deepEqual(diffDictionaries(), []);
});

test('支持的语言仅中英，其余回落中文', () => {
  assert.deepEqual(SUPPORTED_LANGS, ['zh', 'en']);
  assert.equal(resolveLang('ja'), 'zh');
  assert.equal(resolveLang(undefined), 'zh');
});

test('缺键回落中文而不是抛错', () => {
  assert.equal(lookup('en', 'settings.clearCache').length > 0, true);
  assert.equal(lookup('zh', 'not.exist.key'), 'not.exist.key');
});

test('占位符可替换且缺失时保留原样', () => {
  assert.equal(translate('zh', 'status.syncing', { count: 12 }), '已同步 12 条…');
  assert.equal(translate('zh', 'status.syncing', {}), '已同步 {count} 条…');
});

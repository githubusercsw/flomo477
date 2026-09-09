import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../src/shared/core/constants.js';

test('两个分页概念必须分离（SYNC_LIMIT vs PAGE_SIZE）', () => {
  assert.equal(C.SYNC_LIMIT, 200);
  assert.equal(C.PAGE_SIZE, 50);
  assert.notEqual(C.SYNC_LIMIT, C.PAGE_SIZE);
});

test('默认配置覆盖所有设置组', () => {
  const k = Object.keys(C.DEFAULT_CONFIG);
  for (const key of ['captureTrigger', 'captureFields', 'siteBlacklist', 'syncIntervalMinutes', 'defaultSort', 'theme', 'language', 'debug']) {
    assert.equal(k.includes(key), true, `missing ${key}`);
  }
});

test('划词触发四选项与默认值为小图标', () => {
  assert.equal(C.DEFAULT_CONFIG.captureTrigger, 'icon');
});

test('存储键与常量齐备', () => {
  assert.equal(typeof C.STORAGE_KEYS.TOKEN, 'string');
  assert.equal(typeof C.STORAGE_KEYS.SYNC_CURSOR, 'string');
  assert.equal(typeof C.STORAGE_KEYS.SYNC_LOCK, 'string');
  assert.equal(C.DB_VERSION, 1);
});

test('签名与请求参数常量完整', () => {
  assert.equal(C.API_KEY, 'flomo_web');
  assert.equal(C.PLATFORM, 'web');
  assert.equal(C.TZ, '8:0');
  assert.equal(C.SIGN_SECRET.length, 32);
});

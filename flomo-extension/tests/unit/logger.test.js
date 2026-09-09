import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldLog, redact, redactKey, formatEntry } from '../../src/shared/core/logger.js';

test('默认级别为 warn 时 debug 被抑制', () => {
  assert.equal(shouldLog('warn', 'debug'), false);
  assert.equal(shouldLog('warn', 'error'), true);
  assert.equal(shouldLog('debug', 'debug'), true);
});

test('token / 密码 / 签名永不入日志', () => {
  assert.equal(redactKey('token'), true);
  assert.equal(redactKey('access_token'), true);
  assert.equal(redactKey('password'), true);
  assert.equal(redactKey('sign'), true);
  assert.equal(redactKey('Authorization'), true);
  assert.equal(redactKey('endpoint'), false);
});

test('嵌套结构递归脱敏', () => {
  const out = redact({ endpoint: '/memo', headers: { Authorization: 'Bearer abc' }, body: { content: 'x' } });
  assert.equal(out.headers.Authorization, '***');
  assert.equal(out.body.content, '***');
  assert.equal(out.endpoint, '/memo');
});

test('超长字符串折叠，正文不入日志', () => {
  const out = redact({ text: 'a'.repeat(500) });
  assert.equal(out.text, '<500 chars>');
});

test('循环引用不死循环', () => {
  const a = { name: 'x' };
  a.self = a;
  assert.equal(redact(a).self, '[circular]');
});

test('日志条目结构统一', () => {
  const e = formatEntry('error', 'sync', 'failed', { token: 't' });
  assert.equal(e.level, 'error');
  assert.equal(e.scope, 'sync');
  assert.equal(e.detail.token, '***');
});

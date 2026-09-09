import test from 'node:test';
import assert from 'node:assert/strict';
import { mapApiCode, isContractBroken, isRetryable, toEnvelopeError } from '../../src/shared/core/errors.js';
import { API_CODE, ERROR_CODE } from '../../src/shared/core/constants.js';

test('认证类错误码归一', () => {
  assert.equal(mapApiCode(API_CODE.SESSION_EXPIRED), ERROR_CODE.NOT_AUTHENTICATED);
  assert.equal(mapApiCode(API_CODE.NEED_VERIFY), ERROR_CODE.NOT_AUTHENTICATED);
});

test('-1 且含「没有找到」视为 not_found', () => {
  assert.equal(mapApiCode(-1, '没有找到该笔记'), ERROR_CODE.NOT_FOUND);
  assert.equal(mapApiCode(-1, '参数错误'), ERROR_CODE.API_ERROR);
});

test('成功不产生错误码', () => {
  assert.equal(mapApiCode(0), null);
});

test('限流与服务端错误区分', () => {
  assert.equal(mapApiCode(429), ERROR_CODE.RATE_LIMITED);
  assert.equal(mapApiCode(500), ERROR_CODE.API_ERROR);
  assert.equal(mapApiCode(422), ERROR_CODE.VALIDATION_ERROR);
});

test('仅网络类可重试，业务错误不重试', () => {
  assert.equal(isRetryable(ERROR_CODE.NETWORK_ERROR), true);
  assert.equal(isRetryable(ERROR_CODE.TIMEOUT), true);
  assert.equal(isRetryable(ERROR_CODE.API_ERROR), false);
  assert.equal(isRetryable(ERROR_CODE.NOT_AUTHENTICATED), false);
});

test('响应结构异常可识别（接口可能已变更）', () => {
  assert.equal(isContractBroken(null), true);
  assert.equal(isContractBroken({ data: {} }), true);
  assert.equal(isContractBroken({ code: 0, data: {} }), false);
});

test('错误 envelope 形状固定', () => {
  assert.deepEqual(toEnvelopeError(ERROR_CODE.TIMEOUT, 'x'), { ok: false, error: 'timeout', message: 'x' });
});

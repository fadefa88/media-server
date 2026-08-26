import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCookies, passwordMatches } from '../src/auth.mjs';

test('parseCookies handles multiple cookies and encoded values', () => {
  assert.deepEqual(parseCookies('a=1; ldf_session=hello%20world; z=3'), {
    a: '1', ldf_session: 'hello world', z: '3'
  });
});

test('passwordMatches accepts equal values and rejects different values', () => {
  assert.equal(passwordMatches('correct horse battery staple', 'correct horse battery staple'), true);
  assert.equal(passwordMatches('wrong', 'correct horse battery staple'), false);
});

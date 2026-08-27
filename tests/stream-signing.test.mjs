import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertStreamSigningConfig,
  externalizePlayback,
  verifySignedStreamRequest
} from '../src/stream-signing.mjs';

const cfg = assertStreamSigningConfig({
  STREAM_PUBLIC_BASE_URL: 'https://stream.example.test',
  STREAM_SIGNING_SECRET: '0123456789abcdef0123456789abcdef',
  STREAM_SIGNING_TTL_SECONDS: '3600'
});

function request(headers = {}) {
  return { headers };
}

test('DIRECT playback becomes a signed absolute URL only for external requests', () => {
  const playback = { type: 'DIRECT', url: '/stream/42' };
  const local = externalizePlayback(playback, request(), cfg, 1_700_000_000);
  assert.equal(local.url, '/stream/42');

  const external = externalizePlayback(playback, request({ 'x-ldf-external-stream': '1' }), cfg, 1_700_000_000);
  assert.match(external.url, /^https:\/\/stream\.example\.test\/stream\/42\?exp=\d+&sig=/);
  assert.equal(external.externalStream, true);

  const parsed = new URL(external.url);
  const verified = verifySignedStreamRequest(parsed, cfg, 1_700_000_100);
  assert.deepEqual(verified?.type, 'DIRECT');
  assert.equal(verified?.mediaId, 42);
});

test('tampered and expired DIRECT URLs are rejected', () => {
  const playback = { type: 'DIRECT', url: '/stream/42' };
  const external = externalizePlayback(playback, request({ 'cf-connecting-ip': '203.0.113.5' }), cfg, 1_700_000_000);
  const parsed = new URL(external.url);

  parsed.pathname = '/stream/43';
  assert.equal(verifySignedStreamRequest(parsed, cfg, 1_700_000_100), null);

  const original = new URL(external.url);
  assert.equal(verifySignedStreamRequest(original, cfg, 1_700_003_601), null);
});

test('HLS signature is carried in the path so relative assets stay authorized', () => {
  const playback = {
    type: 'HLS',
    sessionId: '123e4567-e89b-12d3-a456-426614174000',
    url: '/playback/123e4567-e89b-12d3-a456-426614174000/index.m3u8'
  };
  const external = externalizePlayback(playback, request({ 'x-ldf-external-stream': 'true' }), cfg, 1_700_000_000);
  const manifest = new URL(external.url);
  const manifestAuth = verifySignedStreamRequest(manifest, cfg, 1_700_000_100);
  assert.equal(manifestAuth?.type, 'HLS');
  assert.equal(manifestAuth?.asset, 'index.m3u8');

  const segment = new URL('seg-000001.m4s', manifest);
  const segmentAuth = verifySignedStreamRequest(segment, cfg, 1_700_000_100);
  assert.equal(segmentAuth?.type, 'HLS');
  assert.equal(segmentAuth?.asset, 'seg-000001.m4s');

  const init = new URL('init.mp4', manifest);
  assert.equal(verifySignedStreamRequest(init, cfg, 1_700_000_100)?.asset, 'init.mp4');
});

test('partial or weak signing configuration is rejected', () => {
  assert.throws(() => assertStreamSigningConfig({
    STREAM_PUBLIC_BASE_URL: 'https://stream.example.test'
  }), /configurati insieme/);

  assert.throws(() => assertStreamSigningConfig({
    STREAM_PUBLIC_BASE_URL: 'https://stream.example.test',
    STREAM_SIGNING_SECRET: 'short'
  }), /almeno 32 caratteri/);
});

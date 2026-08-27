import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertStreamSigningConfig,
  createPlaybackSessionId,
  signDirectStreamUrl,
  verifyPlaybackSessionId,
  verifySignedStreamRequest
} from '../src/stream-signing.mjs';

const cfg = assertStreamSigningConfig({
  STREAM_SIGNING_SECRET: '0123456789abcdef0123456789abcdef',
  STREAM_SIGNING_TTL_SECONDS: '3600'
});

test('DIRECT URL is signed, relative and expires', () => {
  const signed = signDirectStreamUrl(42, cfg, 1_700_000_000);
  assert.match(signed.url, /^\/stream\/42\?exp=\d+&sig=/);
  assert.equal(signed.expiresAt, 1_700_003_600);

  const verified = verifySignedStreamRequest(signed.url, cfg, 1_700_000_100);
  assert.equal(verified?.type, 'DIRECT');
  assert.equal(verified?.mediaId, 42);

  const tampered = new URL(signed.url, 'http://ldf.local');
  tampered.pathname = '/stream/43';
  assert.equal(verifySignedStreamRequest(tampered, cfg, 1_700_000_100), null);
  assert.equal(verifySignedStreamRequest(signed.url, cfg, 1_700_003_601), null);
});

test('HLS session id is a signed temporary capability inherited by relative assets', () => {
  const session = createPlaybackSessionId(cfg, 1_700_000_000);
  assert.match(session.id, /^[0-9a-f]{32}-[0-9a-f]{8,16}-[0-9a-f]{32}$/);
  assert.equal(session.expiresAt, 1_700_003_600);
  assert.equal(verifyPlaybackSessionId(session.id, cfg, 1_700_000_100)?.sessionId, session.id);

  const manifest = `/playback/${session.id}/index.m3u8`;
  assert.equal(verifySignedStreamRequest(manifest, cfg, 1_700_000_100)?.asset, 'index.m3u8');
  assert.equal(verifySignedStreamRequest(`/playback/${session.id}/init.mp4`, cfg, 1_700_000_100)?.asset, 'init.mp4');
  assert.equal(verifySignedStreamRequest(`/playback/${session.id}/seg-000001.m4s`, cfg, 1_700_000_100)?.asset, 'seg-000001.m4s');

  assert.equal(verifySignedStreamRequest(manifest, cfg, 1_700_003_601), null);
});

test('tampered HLS capability is rejected', () => {
  const session = createPlaybackSessionId(cfg, 1_700_000_000);
  const chars = session.id.split('');
  const last = chars.length - 1;
  chars[last] = chars[last] === 'a' ? 'b' : 'a';
  const tampered = chars.join('');
  assert.equal(verifyPlaybackSessionId(tampered, cfg, 1_700_000_100), null);
});

test('weak signing configuration is rejected and disabled config preserves old URLs', () => {
  assert.throws(() => assertStreamSigningConfig({
    STREAM_SIGNING_SECRET: 'short'
  }), /almeno 32 caratteri/);

  const disabled = assertStreamSigningConfig({});
  assert.equal(disabled.enabled, false);
  assert.equal(signDirectStreamUrl(7, disabled, 1_700_000_000).url, '/stream/7');
  assert.match(createPlaybackSessionId(disabled, 1_700_000_000).id, /^[0-9a-f-]{36}$/);
});

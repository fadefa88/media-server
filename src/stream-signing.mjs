import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_SECONDS = 6 * 60 * 60;
const MIN_TTL_SECONDS = 5 * 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;

export function streamSigningConfig(env = process.env) {
  const secret = String(env.STREAM_SIGNING_SECRET || '');
  const requestedTtl = Number(env.STREAM_SIGNING_TTL_SECONDS || DEFAULT_TTL_SECONDS);
  const ttlSeconds = Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS,
    Number.isFinite(requestedTtl) ? Math.floor(requestedTtl) : DEFAULT_TTL_SECONDS));
  return {
    enabled: Boolean(secret),
    secret,
    ttlSeconds
  };
}

export function assertStreamSigningConfig(env = process.env) {
  const cfg = streamSigningConfig(env);
  if (cfg.enabled && cfg.secret.length < 32) {
    throw new Error('STREAM_SIGNING_SECRET deve contenere almeno 32 caratteri');
  }
  return cfg;
}

function hmacBase64Url(secret, value) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function hmacHex(secret, value) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

function signatureMatches(expected, candidate) {
  if (!candidate) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(candidate));
  return a.length === b.length && timingSafeEqual(a, b);
}

function expiryFor(cfg, nowSeconds) {
  return Math.floor(nowSeconds) + cfg.ttlSeconds;
}

function validExpiry(value, nowSeconds) {
  if (!/^\d{10,}$/.test(String(value || ''))) return null;
  const exp = Number(value);
  if (!Number.isSafeInteger(exp) || exp <= Math.floor(nowSeconds)) return null;
  return exp;
}

export function signDirectStreamUrl(mediaId, cfg = streamSigningConfig(), nowSeconds = Date.now() / 1000) {
  const subject = `/stream/${Number(mediaId)}`;
  if (!cfg.enabled) return { url: subject, expiresAt: null };
  const exp = expiryFor(cfg, nowSeconds);
  const sig = hmacBase64Url(cfg.secret, `${subject}\n${exp}`);
  return {
    url: `${subject}?exp=${exp}&sig=${encodeURIComponent(sig)}`,
    expiresAt: exp
  };
}

export function createPlaybackSessionId(cfg = streamSigningConfig(), nowSeconds = Date.now() / 1000) {
  if (!cfg.enabled) return { id: randomUUID(), expiresAt: null };
  const nonce = randomBytes(16).toString('hex');
  const exp = expiryFor(cfg, nowSeconds);
  const expHex = exp.toString(16);
  const sig = hmacHex(cfg.secret, `hls\n${nonce}\n${expHex}`).slice(0, 32);
  return {
    id: `${nonce}-${expHex}-${sig}`,
    expiresAt: exp
  };
}

export function verifyPlaybackSessionId(sessionId, cfg = streamSigningConfig(), nowSeconds = Date.now() / 1000) {
  if (!cfg.enabled) return null;
  const match = /^([0-9a-f]{32})-([0-9a-f]{8,16})-([0-9a-f]{32})$/.exec(String(sessionId || ''));
  if (!match) return null;
  const [, nonce, expHex, sig] = match;
  const exp = Number.parseInt(expHex, 16);
  if (!Number.isSafeInteger(exp) || exp <= Math.floor(nowSeconds)) return null;
  const expected = hmacHex(cfg.secret, `hls\n${nonce}\n${expHex}`).slice(0, 32);
  if (!signatureMatches(expected, sig)) return null;
  return { sessionId: String(sessionId), expiresAt: exp };
}

export function verifySignedStreamRequest(requestUrl, cfg = streamSigningConfig(), nowSeconds = Date.now() / 1000) {
  if (!cfg.enabled || !requestUrl) return null;
  const url = requestUrl instanceof URL ? requestUrl : new URL(String(requestUrl), 'http://ldf.local');

  const direct = /^\/stream\/(\d+)$/.exec(url.pathname);
  if (direct) {
    const exp = validExpiry(url.searchParams.get('exp'), nowSeconds);
    const sig = url.searchParams.get('sig');
    if (!exp) return null;
    const subject = `/stream/${Number(direct[1])}`;
    const expected = hmacBase64Url(cfg.secret, `${subject}\n${exp}`);
    if (!signatureMatches(expected, sig)) return null;
    return { type: 'DIRECT', mediaId: Number(direct[1]), expiresAt: exp };
  }

  const hls = /^\/playback\/([0-9a-f-]+)\/(index\.m3u8|init\.mp4|seg-\d{6}\.m4s)$/.exec(url.pathname);
  if (hls) {
    const verified = verifyPlaybackSessionId(hls[1], cfg, nowSeconds);
    if (!verified) return null;
    return { type: 'HLS', sessionId: hls[1], asset: hls[2], expiresAt: verified.expiresAt };
  }

  return null;
}

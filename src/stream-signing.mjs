import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_SECONDS = 6 * 60 * 60;
const MIN_TTL_SECONDS = 5 * 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:') throw new Error('STREAM_PUBLIC_BASE_URL deve usare https');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('STREAM_PUBLIC_BASE_URL deve essere un origin HTTPS senza credenziali, query o fragment');
  }
  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${pathname === '/' ? '' : pathname}`;
}

export function streamSigningConfig(env = process.env) {
  const baseUrl = normalizeBaseUrl(env.STREAM_PUBLIC_BASE_URL);
  const secret = String(env.STREAM_SIGNING_SECRET || '');
  const requestedTtl = Number(env.STREAM_SIGNING_TTL_SECONDS || DEFAULT_TTL_SECONDS);
  const ttlSeconds = Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS,
    Number.isFinite(requestedTtl) ? Math.floor(requestedTtl) : DEFAULT_TTL_SECONDS));
  return {
    enabled: Boolean(baseUrl && secret),
    baseUrl,
    secret,
    ttlSeconds
  };
}

export function assertStreamSigningConfig(env = process.env) {
  const cfg = streamSigningConfig(env);
  const hasBase = Boolean(String(env.STREAM_PUBLIC_BASE_URL || '').trim());
  const hasSecret = Boolean(String(env.STREAM_SIGNING_SECRET || ''));
  if (hasBase !== hasSecret) {
    throw new Error('STREAM_PUBLIC_BASE_URL e STREAM_SIGNING_SECRET devono essere configurati insieme');
  }
  if (cfg.enabled && cfg.secret.length < 32) {
    throw new Error('STREAM_SIGNING_SECRET deve contenere almeno 32 caratteri');
  }
  return cfg;
}

function signatureFor(secret, subject, expiresAt) {
  return createHmac('sha256', secret)
    .update(`${subject}\n${expiresAt}`)
    .digest('base64url');
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

function signedDirectUrl(mediaId, cfg, nowSeconds) {
  const subject = `/stream/${Number(mediaId)}`;
  const exp = expiryFor(cfg, nowSeconds);
  const sig = signatureFor(cfg.secret, subject, exp);
  return {
    url: `${cfg.baseUrl}${subject}?exp=${exp}&sig=${encodeURIComponent(sig)}`,
    expiresAt: exp
  };
}

function signedHlsUrl(sessionId, cfg, nowSeconds) {
  const subject = `/playback/${sessionId}`;
  const exp = expiryFor(cfg, nowSeconds);
  const sig = signatureFor(cfg.secret, subject, exp);
  return {
    // Keeping the signature in the path makes relative HLS init/segment URLs
    // inherit the same authorization automatically.
    url: `${cfg.baseUrl}${subject}/${exp}/${encodeURIComponent(sig)}/index.m3u8`,
    expiresAt: exp
  };
}

export function shouldUseExternalStream(req, cfg = streamSigningConfig()) {
  if (!cfg.enabled) return false;
  const explicit = String(req?.headers?.['x-ldf-external-stream'] || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(explicit)) return true;
  // Cloudflare Tunnel/Access supplies this header on public requests. The
  // explicit nginx header above remains the preferred deterministic signal.
  return Boolean(String(req?.headers?.['cf-connecting-ip'] || '').trim());
}

export function externalizePlayback(playback, req, cfg = streamSigningConfig(), nowSeconds = Date.now() / 1000) {
  if (!playback || playback.type === 'BLOCKED' || !shouldUseExternalStream(req, cfg)) return playback;

  let signed;
  if (playback.type === 'DIRECT') {
    const match = /^\/stream\/(\d+)$/.exec(String(playback.url || ''));
    if (!match) return playback;
    signed = signedDirectUrl(Number(match[1]), cfg, nowSeconds);
  } else if (playback.type === 'HLS' && playback.sessionId) {
    signed = signedHlsUrl(String(playback.sessionId), cfg, nowSeconds);
  } else {
    return playback;
  }

  return {
    ...playback,
    url: signed.url,
    externalStream: true,
    urlExpiresAt: new Date(signed.expiresAt * 1000).toISOString()
  };
}

function validExpiry(value, nowSeconds) {
  if (!/^\d{10,}$/.test(String(value || ''))) return null;
  const exp = Number(value);
  if (!Number.isSafeInteger(exp) || exp <= Math.floor(nowSeconds)) return null;
  return exp;
}

export function verifySignedStreamRequest(url, cfg = streamSigningConfig(), nowSeconds = Date.now() / 1000) {
  if (!cfg.enabled || !url) return null;

  const direct = /^\/stream\/(\d+)$/.exec(url.pathname);
  if (direct) {
    const exp = validExpiry(url.searchParams.get('exp'), nowSeconds);
    const sig = url.searchParams.get('sig');
    if (!exp) return null;
    const subject = `/stream/${Number(direct[1])}`;
    if (!signatureMatches(signatureFor(cfg.secret, subject, exp), sig)) return null;
    return { type: 'DIRECT', mediaId: Number(direct[1]), expiresAt: exp };
  }

  const hls = /^\/playback\/([0-9a-f-]+)\/(\d+)\/([A-Za-z0-9_-]+)\/(index\.m3u8|init\.mp4|seg-\d{6}\.m4s)$/.exec(url.pathname);
  if (hls) {
    const [, sessionId, expText, sig, asset] = hls;
    const exp = validExpiry(expText, nowSeconds);
    if (!exp) return null;
    const subject = `/playback/${sessionId}`;
    if (!signatureMatches(signatureFor(cfg.secret, subject, exp), sig)) return null;
    return { type: 'HLS', sessionId, asset, expiresAt: exp };
  }

  return null;
}

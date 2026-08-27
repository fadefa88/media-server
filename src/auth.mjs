import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { assertStreamSigningConfig, verifySignedStreamRequest } from './stream-signing.mjs';

const COOKIE_NAME = 'ldf_session';
const sessionCache = new Map();
const loginAttempts = new Map();

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function authEnabled() {
  return boolEnv('AUTH_ENABLED', false);
}

export function authConfig() {
  return {
    enabled: authEnabled(),
    username: String(process.env.AUTH_USERNAME || '').trim(),
    password: String(process.env.AUTH_PASSWORD || ''),
    maxSessions: Math.max(1, Math.min(10, Number(process.env.MAX_AUTH_SESSIONS || 2))),
    ttlDays: Math.max(1, Math.min(365, Number(process.env.AUTH_SESSION_TTL_DAYS || 30))),
    profileId: String(process.env.DEFAULT_PROFILE || 'default').trim() || 'default'
  };
}

export function assertAuthConfig() {
  // Stream signing is optional, but when enabled its secret must be strong.
  assertStreamSigningConfig();
  const cfg = authConfig();
  if (!cfg.enabled) return cfg;
  if (!cfg.username || !cfg.password) {
    throw new Error('AUTH_ENABLED=true richiede AUTH_USERNAME e AUTH_PASSWORD');
  }
  if (cfg.password.length < 10) {
    throw new Error('AUTH_PASSWORD deve contenere almeno 10 caratteri');
  }
  return cfg;
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  }
  return out;
}

function digest(value) {
  return createHash('sha256').update(String(value)).digest();
}

function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function passwordMatches(candidate, expected) {
  const a = digest(candidate);
  const b = digest(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requestIp(req) {
  return String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
    .split(',')[0].trim().slice(0, 128);
}

function isHttps(req) {
  if (boolEnv('AUTH_SECURE_COOKIE', false)) return true;
  return String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
}

function cookieAttributes(req, maxAge) {
  const attrs = [`Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=${Math.max(0, Math.floor(maxAge))}`];
  if (isHttps(req)) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearSessionCookie(req) {
  return `${COOKIE_NAME}=; ${cookieAttributes(req, 0)}`;
}

function sessionCookie(req, token, maxAge) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieAttributes(req, maxAge)}`;
}

function rateKey(req) {
  return requestIp(req) || 'unknown';
}

export function canAttemptLogin(req) {
  const key = rateKey(req);
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const current = loginAttempts.get(key) || [];
  const recent = current.filter(ts => now - ts < windowMs);
  loginAttempts.set(key, recent);
  return recent.length < 6;
}

export function recordLoginFailure(req) {
  const key = rateKey(req);
  const recent = loginAttempts.get(key) || [];
  recent.push(Date.now());
  loginAttempts.set(key, recent.slice(-12));
}

export function clearLoginFailures(req) {
  loginAttempts.delete(rateKey(req));
}

export async function cleanupExpiredSessions(pool) {
  const result = await pool.query(`DELETE FROM auth_sessions WHERE expires_at <= now() RETURNING token_hash`);
  for (const row of result.rows) sessionCache.delete(row.token_hash);
  return result.rowCount;
}

export async function createAuthSession(pool, req, username, password) {
  const cfg = assertAuthConfig();
  if (!cfg.enabled) return { authenticated: true, disabled: true, profileId: cfg.profileId };
  if (!canAttemptLogin(req)) {
    return { authenticated: false, status: 429, error: 'Troppi tentativi. Riprova tra qualche minuto.' };
  }
  if (!passwordMatches(username, cfg.username) || !passwordMatches(password, cfg.password)) {
    recordLoginFailure(req);
    return { authenticated: false, status: 401, error: 'Credenziali non valide' };
  }

  clearLoginFailures(req);
  await cleanupExpiredSessions(pool);

  const existing = await pool.query(`
    SELECT token_hash FROM auth_sessions
    WHERE username=$1
    ORDER BY created_at DESC
  `, [cfg.username]);
  const remove = existing.rows.slice(Math.max(0, cfg.maxSessions - 1)).map(row => row.token_hash);
  if (remove.length) {
    await pool.query(`DELETE FROM auth_sessions WHERE token_hash = ANY($1::text[])`, [remove]);
    for (const tokenHash of remove) sessionCache.delete(tokenHash);
  }

  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const maxAge = cfg.ttlDays * 24 * 60 * 60;
  const expiresAt = new Date(Date.now() + maxAge * 1000);
  await pool.query(`
    INSERT INTO auth_sessions(token_hash,username,profile_id,expires_at,user_agent,ip_address)
    VALUES($1,$2,$3,$4,$5,$6)
  `, [
    tokenHash,
    cfg.username,
    cfg.profileId,
    expiresAt.toISOString(),
    String(req.headers['user-agent'] || '').slice(0, 512),
    requestIp(req)
  ]);

  const session = {
    authenticated: true,
    username: cfg.username,
    profileId: cfg.profileId,
    expiresAt: expiresAt.toISOString()
  };
  sessionCache.set(tokenHash, { session, validUntil: Date.now() + 60_000 });
  return { ...session, setCookie: sessionCookie(req, token, maxAge) };
}

export async function getAuthSession(pool, req) {
  const cfg = authConfig();

  // Signed stream URLs are short-lived bearer capabilities. They authorize
  // only /stream/* or /playback/* and therefore do not expose UI/API routes.
  const signedStream = verifySignedStreamRequest(req.url);
  if (signedStream) {
    return {
      authenticated: true,
      signedStream: true,
      username: 'signed-stream',
      profileId: cfg.profileId,
      expiresAt: new Date(signedStream.expiresAt * 1000).toISOString()
    };
  }

  if (!cfg.enabled) return { authenticated: true, disabled: true, username: cfg.username || 'local', profileId: cfg.profileId };

  const token = parseCookies(req.headers.cookie || '')[COOKIE_NAME];
  if (!token) return { authenticated: false };
  const tokenHash = hashToken(token);
  const cached = sessionCache.get(tokenHash);
  if (cached && cached.validUntil > Date.now()) return cached.session;

  const result = await pool.query(`
    SELECT username,profile_id,expires_at
    FROM auth_sessions
    WHERE token_hash=$1 AND expires_at > now()
  `, [tokenHash]);
  if (!result.rowCount) {
    sessionCache.delete(tokenHash);
    return { authenticated: false };
  }

  const row = result.rows[0];
  const session = {
    authenticated: true,
    username: row.username,
    profileId: row.profile_id,
    expiresAt: row.expires_at
  };
  sessionCache.set(tokenHash, { session, validUntil: Date.now() + 60_000 });
  return session;
}

export async function destroyAuthSession(pool, req) {
  const token = parseCookies(req.headers.cookie || '')[COOKIE_NAME];
  if (!token) return false;
  const tokenHash = hashToken(token);
  sessionCache.delete(tokenHash);
  const result = await pool.query(`DELETE FROM auth_sessions WHERE token_hash=$1`, [tokenHash]);
  return result.rowCount > 0;
}

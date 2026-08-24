import http from 'node:http';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, initDb } from './db.mjs';
import { createScanState, scanLibrary } from './scanner.mjs';
import {
  createPlayback,
  getPlaybackSession,
  planPlayback,
  playbackMime,
  resolvePlaybackAsset,
  stopPlayback
} from './playback.mjs';
import { streamSubtitleAsWebVtt } from './subtitles.mjs';
import { createMetadataState, enrichLibrary, enrichMedia, getTvSeriesSeasons, tmdbConfigured } from './tmdb.mjs';
import { decorateMedia, getHome, getProgress, saveProgress, searchLibrary } from './library.mjs';
import {
  applyMetadataCandidate,
  createRescueState,
  listMetadataReview,
  rescueLibrary,
  rescueMedia,
  rescueProviderConfig,
  searchMetadataCandidates,
  unlockMetadata
} from './metadata-rescue.mjs';

const PORT = Number(process.env.PORT || 4173);
const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || '/media');
const VIDEO_TRANSCODE_ENABLED = String(process.env.VIDEO_TRANSCODE_ENABLED || 'false').toLowerCase() === 'true';
const PROFILE_ID = String(process.env.DEFAULT_PROFILE || 'default').trim() || 'default';
const PROFILE_NAME = String(process.env.DEFAULT_PROFILE_NAME || 'Home').trim() || 'Home';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const pool = createPool();
const scanState = createScanState();
const metadataState = createMetadataState();
const rescueState = createRescueState();

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

async function readJson(req, maxBytes = 128 * 1024) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > maxBytes) throw new Error('payload troppo grande');
  }
  return data ? JSON.parse(data) : {};
}

function mimeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.mp4': case '.m4v': return 'video/mp4';
    case '.mov': return 'video/quicktime';
    case '.webm': return 'video/webm';
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': case '.mjs': return 'text/javascript; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.json': return 'application/json; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

function ensureInsideMedia(filePath) {
  const resolved = path.resolve(filePath);
  return resolved === MEDIA_ROOT || resolved.startsWith(`${MEDIA_ROOT}${path.sep}`);
}

async function serveStatic(res, pathname) {
  const target = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, target);
  if (!(filePath === PUBLIC_DIR || filePath.startsWith(`${PUBLIC_DIR}${path.sep}`))) {
    json(res, 403, { error: 'forbidden' }); return;
  }
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('not file');
    const body = await fs.readFile(filePath);
    res.writeHead(200, { 'content-type': mimeFor(filePath), 'content-length': body.length, 'cache-control': 'no-cache' });
    res.end(body);
  } catch { json(res, 404, { error: 'not found' }); }
}

async function getMediaWithStreams(id) {
  const mediaResult = await pool.query(`
    SELECT m.*, p.position_seconds, p.duration_seconds AS progress_duration_seconds, p.completed, p.updated_at AS progress_updated_at
    FROM media m
    LEFT JOIN playback_progress p ON p.media_id=m.id AND p.profile_id=$2
    WHERE m.id=$1
  `, [id, PROFILE_ID]);
  if (!mediaResult.rowCount) return null;
  const streamResult = await pool.query('SELECT * FROM media_streams WHERE media_id=$1 ORDER BY stream_index', [id]);
  return { media: decorateMedia(mediaResult.rows[0]), streams: streamResult.rows };
}

async function getRawMedia(id) {
  const result = await pool.query(`SELECT * FROM media WHERE id=$1 AND status='OK'`, [id]);
  return result.rows[0] || null;
}

async function streamOriginal(req, res, id) {
  const result = await pool.query('SELECT id, path, status FROM media WHERE id=$1', [id]);
  if (!result.rowCount || result.rows[0].status !== 'OK') { json(res, 404, { error: 'media not found' }); return; }
  const filePath = result.rows[0].path;
  if (!ensureInsideMedia(filePath)) { json(res, 403, { error: 'invalid media path' }); return; }
  const stat = await fs.stat(filePath);
  const total = stat.size;
  const range = req.headers.range;
  res.setHeader('accept-ranges', 'bytes');
  res.setHeader('content-type', mimeFor(filePath));
  res.setHeader('cache-control', 'private, no-store');
  if (!range) { res.writeHead(200, { 'content-length': total }); createReadStream(filePath).pipe(res); return; }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) { res.writeHead(416, { 'content-range': `bytes */${total}` }); res.end(); return; }
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : total - 1;
  if (!match[1] && match[2]) { const suffix = Number(match[2]); start = Math.max(0, total - suffix); end = total - 1; }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= total || start > end) {
    res.writeHead(416, { 'content-range': `bytes */${total}` }); res.end(); return;
  }
  res.writeHead(206, { 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${total}` });
  createReadStream(filePath, { start, end }).pipe(res);
}

async function servePlaybackAsset(res, sessionId, asset) {
  const resolved = await resolvePlaybackAsset(sessionId, asset);
  if (!resolved) { json(res, 404, { error: 'playback asset not found' }); return; }
  res.writeHead(200, {
    'content-type': playbackMime(asset),
    'content-length': resolved.stat.size,
    'cache-control': asset.endsWith('.m3u8') ? 'no-store' : 'private, max-age=3600'
  });
  createReadStream(resolved.filePath).pipe(res);
}

function defaultClient(body = {}) {
  return body.client || {
    videoCodecs: ['h264', 'hevc'], audioCodecs: ['aac', 'ac3', 'eac3'],
    containers: ['mp4', 'mov', 'hls', 'fmp4'], subtitleFormats: ['vtt', 'webvtt'],
    maxWidth: 4096, maxHeight: 2160, networkMbps: 100
  };
}

async function metadataSummary() {
  const counts = await pool.query(`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE metadata_status='READY')::int AS ready,
      count(*) FILTER (WHERE metadata_status='PENDING')::int AS pending,
      count(*) FILTER (WHERE metadata_status='MISS')::int AS missed,
      count(*) FILTER (WHERE metadata_status='ERROR')::int AS errors,
      count(*) FILTER (WHERE metadata_status='NEEDS_REVIEW')::int AS needs_review,
      count(*) FILTER (WHERE metadata_locked=true)::int AS locked
    FROM media WHERE status='OK'
  `);
  const providers = await pool.query(`
    SELECT COALESCE(metadata_provider,'unmatched') AS provider, count(*)::int AS count
    FROM media WHERE status='OK' GROUP BY COALESCE(metadata_provider,'unmatched') ORDER BY count DESC
  `);
  return {
    configured: tmdbConfigured(),
    providers: rescueProviderConfig(),
    providerCounts: Object.fromEntries(providers.rows.map(r => [r.provider, Number(r.count)])),
    ...counts.rows[0],
    state: metadataState,
    rescueState
  };
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    const db = await pool.query('SELECT 1 AS ok');
    json(res, 200, {
      ok: Boolean(db.rows[0]?.ok), name: 'vela-media', version: '0.6.0', clientFirst: true,
      playback: ['DIRECT', 'REMUX', 'AUDIO_TRANSCODE'],
      features: ['CINEMA_UI', 'TMDB', 'METADATA_RESCUE', 'TVMAZE', 'OMDB_OPTIONAL', 'ANILIST', 'MANUAL_METADATA_REVIEW', 'CONTINUE_WATCHING', 'ARBITRARY_SEEK', 'WEBVTT_SUBTITLES', 'AUDIO_TRACK_SELECTION'],
      tmdbConfigured: tmdbConfigured(), metadataProviders: rescueProviderConfig(),
      profile: { id: PROFILE_ID, name: PROFILE_NAME },
      videoTranscodeEnabled: VIDEO_TRANSCODE_ENABLED
    }); return;
  }

  if (req.method === 'GET' && url.pathname === '/api/home') {
    json(res, 200, { ...(await getHome(pool, PROFILE_ID)), metadata: await metadataSummary(), profile: { id: PROFILE_ID, name: PROFILE_NAME } }); return;
  }

  if (req.method === 'GET' && url.pathname === '/api/search') {
    const q = url.searchParams.get('q') || '';
    json(res, 200, { query: q, items: await searchLibrary(pool, q, PROFILE_ID, 60) }); return;
  }

  if (req.method === 'GET' && url.pathname === '/api/metadata/status') {
    json(res, 200, await metadataSummary()); return;
  }

  const tvSeasonsMatch = /^\/api\/tmdb\/tv\/(\d+)\/seasons$/.exec(url.pathname);
  if (req.method === 'GET' && tvSeasonsMatch) {
    if (!tmdbConfigured()) { json(res, 409, { error: 'TMDB_API_TOKEN non configurato' }); return; }
    json(res, 200, await getTvSeriesSeasons(Number(tvSeasonsMatch[1]))); return;
  }

  if (req.method === 'POST' && url.pathname === '/api/metadata/enrich') {
    if (!tmdbConfigured()) { json(res, 409, { error: 'TMDB_API_TOKEN non configurato' }); return; }
    if (metadataState.running) { json(res, 409, { error: 'arricchimento TMDB gia in esecuzione', state: metadataState }); return; }
    const body = await readJson(req);
    const limit = Math.max(0, Math.min(Number(body.limit || 0), 100000));
    enrichLibrary({ pool, limit, force: Boolean(body.force), state: metadataState }).catch(error => {
      metadataState.lastError = String(error?.message || error); metadataState.running = false; metadataState.finishedAt = new Date().toISOString();
    });
    json(res, 202, { accepted: true, limit, force: Boolean(body.force), state: metadataState }); return;
  }

  if (req.method === 'POST' && url.pathname === '/api/metadata/rescue') {
    if (rescueState.running) { json(res, 409, { error: 'Metadata Rescue gia in esecuzione', state: rescueState }); return; }
    const body = await readJson(req);
    const limit = Math.max(0, Math.min(Number(body.limit || 0), 100000));
    rescueLibrary({ pool, limit, force: Boolean(body.force), state: rescueState }).catch(error => {
      rescueState.lastError = String(error?.message || error); rescueState.running = false; rescueState.finishedAt = new Date().toISOString();
    });
    json(res, 202, { accepted: true, limit, force: Boolean(body.force), providers: rescueProviderConfig(), state: rescueState }); return;
  }

  if (req.method === 'GET' && url.pathname === '/api/metadata/review') {
    const limit = Number(url.searchParams.get('limit') || 50);
    const offset = Number(url.searchParams.get('offset') || 0);
    json(res, 200, await listMetadataReview(pool, { limit, offset })); return;
  }

  const metadataOneMatch = /^\/api\/media\/(\d+)\/metadata$/.exec(url.pathname);
  if (req.method === 'POST' && metadataOneMatch) {
    if (!tmdbConfigured()) { json(res, 409, { error: 'TMDB_API_TOKEN non configurato' }); return; }
    const media = await getRawMedia(Number(metadataOneMatch[1]));
    if (!media) { json(res, 404, { error: 'media not found' }); return; }
    json(res, 200, await enrichMedia(pool, media)); return;
  }

  const rescueOneMatch = /^\/api\/media\/(\d+)\/metadata\/rescue$/.exec(url.pathname);
  if (req.method === 'POST' && rescueOneMatch) {
    const media = await getRawMedia(Number(rescueOneMatch[1]));
    if (!media) { json(res, 404, { error: 'media not found' }); return; }
    const body = await readJson(req);
    json(res, 200, await rescueMedia(pool, media, { force: Boolean(body.force) })); return;
  }

  const candidatesMatch = /^\/api\/media\/(\d+)\/metadata\/candidates$/.exec(url.pathname);
  if (req.method === 'GET' && candidatesMatch) {
    const media = await getRawMedia(Number(candidatesMatch[1]));
    if (!media) { json(res, 404, { error: 'media not found' }); return; }
    const q = url.searchParams.get('q') || '';
    json(res, 200, { mediaId: media.id, query: q, items: await searchMetadataCandidates(media, q) }); return;
  }

  const applyMetadataMatch = /^\/api\/media\/(\d+)\/metadata\/apply$/.exec(url.pathname);
  if (req.method === 'POST' && applyMetadataMatch) {
    const media = await getRawMedia(Number(applyMetadataMatch[1]));
    if (!media) { json(res, 404, { error: 'media not found' }); return; }
    const candidate = await readJson(req);
    json(res, 200, await applyMetadataCandidate(pool, media, candidate)); return;
  }

  const unlockMetadataMatch = /^\/api\/media\/(\d+)\/metadata\/unlock$/.exec(url.pathname);
  if (req.method === 'POST' && unlockMetadataMatch) {
    const unlocked = await unlockMetadata(pool, Number(unlockMetadataMatch[1]));
    json(res, unlocked ? 200 : 404, { unlocked }); return;
  }

  if (req.method === 'GET' && url.pathname === '/api/scan/status') { json(res, 200, scanState); return; }
  if (req.method === 'POST' && url.pathname === '/api/scan') {
    if (scanState.running) { json(res, 409, { error: 'scan gia in esecuzione', state: scanState }); return; }
    const body = await readJson(req);
    const limit = Math.max(0, Math.min(Number(body.limit || 0), 100000));
    scanLibrary({ pool, limit, state: scanState }).catch(error => {
      scanState.lastError = String(error?.message || error); scanState.running = false; scanState.finishedAt = new Date().toISOString();
    });
    json(res, 202, { accepted: true, limit, state: scanState }); return;
  }

  if (req.method === 'GET' && url.pathname === '/api/media') {
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 100), 500));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
    const result = await pool.query(`
      SELECT m.*, p.position_seconds, p.duration_seconds AS progress_duration_seconds, p.completed, p.updated_at AS progress_updated_at
      FROM media m LEFT JOIN playback_progress p ON p.media_id=m.id AND p.profile_id=$3
      ORDER BY m.relative_path LIMIT $1 OFFSET $2
    `, [limit, offset, PROFILE_ID]);
    const count = await pool.query('SELECT count(*)::int AS count FROM media');
    json(res, 200, { count: count.rows[0].count, items: result.rows.map(decorateMedia) }); return;
  }

  const mediaMatch = /^\/api\/media\/(\d+)$/.exec(url.pathname);
  if (req.method === 'GET' && mediaMatch) {
    const record = await getMediaWithStreams(Number(mediaMatch[1]));
    if (!record) json(res, 404, { error: 'media not found' }); else json(res, 200, record); return;
  }

  const progressMatch = /^\/api\/media\/(\d+)\/progress$/.exec(url.pathname);
  if (req.method === 'GET' && progressMatch) { json(res, 200, await getProgress(pool, Number(progressMatch[1]), PROFILE_ID)); return; }
  if (req.method === 'PUT' && progressMatch) {
    const body = await readJson(req);
    json(res, 200, await saveProgress(pool, Number(progressMatch[1]), PROFILE_ID, body)); return;
  }

  const subtitleMatch = /^\/api\/media\/(\d+)\/subtitle\/(\d+)\.vtt$/.exec(url.pathname);
  if (req.method === 'GET' && subtitleMatch) {
    const record = await getMediaWithStreams(Number(subtitleMatch[1]));
    if (!record || record.media.status !== 'OK') { json(res, 404, { error: 'media not found' }); return; }
    if (!ensureInsideMedia(record.media.path)) { json(res, 403, { error: 'invalid media path' }); return; }
    streamSubtitleAsWebVtt({ record, streamIndex: Number(subtitleMatch[2]), offsetSeconds: Math.max(0, Number(url.searchParams.get('offset') || 0)), res }); return;
  }

  const decisionMatch = /^\/api\/media\/(\d+)\/decision$/.exec(url.pathname);
  if (req.method === 'POST' && decisionMatch) {
    const record = await getMediaWithStreams(Number(decisionMatch[1]));
    if (!record) { json(res, 404, { error: 'media not found' }); return; }
    const body = await readJson(req);
    const plan = planPlayback(record, defaultClient(body), body);
    json(res, 200, { selectedTracks: plan.selected, decision: plan.decision }); return;
  }

  const playbackCreateMatch = /^\/api\/media\/(\d+)\/playback$/.exec(url.pathname);
  if (req.method === 'POST' && playbackCreateMatch) {
    const record = await getMediaWithStreams(Number(playbackCreateMatch[1]));
    if (!record || record.media.status !== 'OK') { json(res, 404, { error: 'media not found' }); return; }
    if (!ensureInsideMedia(record.media.path)) { json(res, 403, { error: 'invalid media path' }); return; }
    const body = await readJson(req);
    const playback = await createPlayback(record, defaultClient(body), body);
    json(res, playback.type === 'BLOCKED' ? 409 : 201, playback); return;
  }

  const playbackStatusMatch = /^\/api\/playback\/([0-9a-f-]+)$/.exec(url.pathname);
  if (req.method === 'GET' && playbackStatusMatch) {
    const session = getPlaybackSession(playbackStatusMatch[1]);
    if (!session) { json(res, 404, { error: 'playback session not found' }); return; }
    json(res, 200, {
      id: session.id, mediaId: session.mediaId, mode: session.mode, state: session.state,
      startSeconds: session.startSeconds, durationSeconds: session.durationSeconds,
      createdAt: new Date(session.createdAt).toISOString(), exitCode: session.exitCode ?? null,
      error: session.state === 'ERROR' ? session.stderr.slice(-2000) : null
    }); return;
  }
  if (req.method === 'DELETE' && playbackStatusMatch) { const removed = await stopPlayback(playbackStatusMatch[1]); json(res, removed ? 200 : 404, { removed }); return; }

  const streamMatch = /^\/stream\/(\d+)$/.exec(url.pathname);
  if (req.method === 'GET' && streamMatch) { await streamOriginal(req, res, Number(streamMatch[1])); return; }
  const playbackAssetMatch = /^\/playback\/([0-9a-f-]+)\/(index\.m3u8|init\.mp4|seg-\d{6}\.m4s)$/.exec(url.pathname);
  if (req.method === 'GET' && playbackAssetMatch) { await servePlaybackAsset(res, playbackAssetMatch[1], playbackAssetMatch[2]); return; }

  if (req.method === 'GET') { await serveStatic(res, url.pathname); return; }
  json(res, 404, { error: 'not found' });
}

async function main() {
  await initDb(pool);
  const server = http.createServer((req, res) => route(req, res).catch(error => {
    console.error(error); if (!res.headersSent) json(res, 500, { error: error?.message || 'internal error' }); else res.destroy();
  }));
  server.listen(PORT, '0.0.0.0', () => console.log(`VELA v0.6 listening on :${PORT}`));
  const shutdown = async () => server.close(async () => { await pool.end().catch(() => {}); process.exit(0); });
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}

main().catch(error => { console.error(error); process.exit(1); });

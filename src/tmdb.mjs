import path from 'node:path';

const API_ROOT = 'https://api.themoviedb.org/3';
const IMAGE_ROOT = 'https://image.tmdb.org/t/p';
const TOKEN = String(process.env.TMDB_API_TOKEN || process.env.TMDB_BEARER_TOKEN || '').trim();
const LANGUAGE = process.env.TMDB_LANGUAGE || 'it-IT';
const REGION = process.env.TMDB_REGION || 'IT';
const DELAY_MS = Math.max(0, Number(process.env.TMDB_DELAY_MS || 220));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let lastRequestAt = 0;
const seasonArtworkCache = new Map();
const SEASON_CACHE_MS = 6 * 60 * 60 * 1000;
const SERIES_ALIASES = new Map([
  ['op2', 'One Piece']
]);

export function tmdbConfigured() {
  return Boolean(TOKEN);
}

function normal(s = '') {
  return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function seriesAlias(value = '') {
  return SERIES_ALIASES.get(normal(value)) || value;
}

function releaseYear(text = '') {
  const m = String(text).match(/(?:^|[^0-9])((?:19|20)\d{2})(?:[^0-9]|$)/);
  return m ? Number(m[1]) : null;
}

function cleanTitle(raw = '') {
  let s = path.basename(String(raw), path.extname(String(raw)));
  const y = s.search(/\b(?:19|20)\d{2}\b/);
  const beforeYear = y >= 0 ? s.slice(0, y) : s;
  if (beforeYear.includes(' - ')) {
    const primary = beforeYear.split(' - ')[0].trim();
    if (primary.length >= 3) s = `${primary} ${y >= 0 ? s.slice(y) : ''}`;
  }
  s = s.replace(/[._]+/g, ' ')
    .replace(/[\[\{].*?[\]\}]/g, ' ')
    .replace(/\bS\d{1,2}E\d{1,4}\b/ig, ' ')
    .replace(/\b\d{1,2}x\d{1,4}\b/ig, ' ')
    .replace(/\bE\d{2,4}\b/ig, ' ')
    .replace(/\b(?:2|5|7)\s+1\b/g, ' ')
    .replace(/\b(?:2160p|1080p|720p|576p|480p|4k|uhd|bluray|blu-ray|brrip|bdrip|webrip|web-dl|webdl|hdtv|remux|dvdrip|xvid|h264|h\.264|h265|h\.265|x264|x265|hevc|av1|hdr10\+?|hdr|dolby\s*vision|dovi|aac|ac3|eac3|ddp|dts(?:-hd)?|truehd|atmos|ita|italian|eng|english|multi|sub|subs|mirc(?:rew)?)\b/ig, ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/[()\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

function seasonEpisode(relativePath = '', filename = '') {
  const all = `${relativePath} ${filename}`;
  const normalMatch = all.match(/\bS(\d{1,3})E(\d{1,4})\b/i);
  if (normalMatch) return { season: Number(normalMatch[1]), episode: Number(normalMatch[2]) };
  const alt = all.match(/\b(\d{1,3})x(\d{1,4})\b/i);
  if (alt) return { season: Number(alt[1]), episode: Number(alt[2]) };
  const seasonFolder = relativePath.match(/(?:^|[\\/])S(\d{1,3})(?:[\\/]|$)/i);
  const episodeOnly = filename.match(/\bE(\d{2,4})\b/i);
  if (seasonFolder && episodeOnly) return { season: Number(seasonFolder[1]), episode: Number(episodeOnly[1]) };
  const bareAbsoluteEpisode = path.basename(String(filename), path.extname(String(filename))).match(/\s-\s*(\d{3,4})(?=\s*(?:[\[(]|$))/);
  if (seasonFolder && bareAbsoluteEpisode) return { season: Number(seasonFolder[1]), episode: Number(bareAbsoluteEpisode[1]) };
  return null;
}

export function parseMediaIdentity(media) {
  const rel = String(media.relative_path || media.filename || '');
  const se = seasonEpisode(rel, media.filename || '');
  const year = releaseYear(media.filename) || releaseYear(rel);
  const parts = rel.split(/[\\/]/).filter(Boolean);
  let titleSource = media.filename || rel;
  if (se) {
    const seasonIndex = parts.findIndex(p => /^S\d{1,3}$/i.test(p));
    if (seasonIndex > 0) titleSource = parts[seasonIndex - 1];
    else titleSource = String(media.filename || '').split(/\bS\d{1,3}E\d{1,4}\b|\b\d{1,3}x\d{1,4}\b|\bE\d{2,4}\b/i)[0];
  }
  const cleaned = cleanTitle(titleSource) || cleanTitle(media.filename || '');
  return { kind: se ? 'tv' : 'movie', query: seriesAlias(cleaned), year, season: se?.season ?? null, episode: se?.episode ?? null };
}

export function resolveTmdbSeasonEpisode(episodes = [], requestedEpisode) {
  const requested = Number(requestedEpisode);
  if (!Number.isInteger(requested) || requested < 1 || !Array.isArray(episodes)) return null;
  const exact = episodes.find(item => Number(item?.episode_number) === requested);
  if (exact) return exact;
  return episodes[requested - 1] || null;
}

async function request(endpoint, params = {}) {
  if (!TOKEN) throw new Error('TMDB_API_TOKEN non configurato');
  const wait = Math.max(0, DELAY_MS - (Date.now() - lastRequestAt));
  if (wait) await sleep(wait);
  lastRequestAt = Date.now();
  const url = new URL(`${API_ROOT}${endpoint}`);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`TMDB ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

async function requestTvEpisode(seriesId, season, episode) {
  try {
    return await request(`/tv/${seriesId}/season/${season}/episode/${episode}`, { language: LANGUAGE });
  } catch {
    try {
      const seasonDetails = await request(`/tv/${seriesId}/season/${season}`, { language: LANGUAGE });
      return resolveTmdbSeasonEpisode(seasonDetails?.episodes, episode);
    } catch {
      return null;
    }
  }
}

function imageUrl(filePath, size = 'w342') {
  return filePath ? `${IMAGE_ROOT}/${size}${filePath}` : null;
}

export async function getTvSeriesSeasons(seriesId) {
  if (!tmdbConfigured()) throw new Error('TMDB_API_TOKEN non configurato');
  const id = Number(seriesId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('TMDB series id non valido');
  const cached = seasonArtworkCache.get(id);
  if (cached && Date.now() - cached.at < SEASON_CACHE_MS) return cached.value;

  const details = await request(`/tv/${id}`, { language: LANGUAGE });
  const seasons = (Array.isArray(details.seasons) ? details.seasons : []).map(season => ({
    id: season.id ?? null,
    seasonNumber: Number(season.season_number),
    name: season.name || (Number(season.season_number) === 0 ? 'Speciali' : `Stagione ${season.season_number}`),
    overview: season.overview || null,
    airDate: season.air_date || null,
    episodeCount: Number(season.episode_count || 0),
    posterPath: season.poster_path || null,
    posterUrl: imageUrl(season.poster_path, 'w342')
  })).sort((a, b) => a.seasonNumber - b.seasonNumber);

  const value = {
    tmdbId: id,
    title: details.name || null,
    posterPath: details.poster_path || null,
    posterUrl: imageUrl(details.poster_path, 'w342'),
    backdropPath: details.backdrop_path || null,
    backdropUrl: imageUrl(details.backdrop_path, 'w1280'),
    seasons
  };
  seasonArtworkCache.set(id, { at: Date.now(), value });
  return value;
}

function chooseBest(results = [], identity) {
  const q = normal(identity.query); let best = null, bestScore = -Infinity;
  for (const item of results.slice(0, 12)) {
    const candidate = normal(item.title || item.name || item.original_title || item.original_name);
    const candidateYear = Number(String(item.release_date || item.first_air_date || '').slice(0, 4)) || null;
    let score = 0;
    if (candidate === q) score += 120; else if (candidate.startsWith(q) || q.startsWith(candidate)) score += 70; else if (candidate.includes(q) || q.includes(candidate)) score += 40;
    const qWords = new Set(q.split(' ').filter(Boolean)), cWords = new Set(candidate.split(' ').filter(Boolean));
    score += [...qWords].filter(w => cWords.has(w)).length * 9;
    if (identity.year && candidateYear) score += Math.max(0, 32 - Math.abs(identity.year - candidateYear) * 14);
    score += Math.min(12, Number(item.vote_count || 0) / 500) + Math.min(8, Number(item.popularity || 0) / 25);
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return bestScore >= 32 ? best : null;
}

async function lookup(identity) {
  if (!identity.query) return null;
  if (identity.kind === 'tv') {
    const search = await request('/search/tv', { query: identity.query, language: LANGUAGE, include_adult: false, first_air_date_year: identity.year || undefined });
    const hit = chooseBest(search.results, identity); if (!hit) return null;
    const details = await request(`/tv/${hit.id}`, { language: LANGUAGE, append_to_response: 'images' });
    let episode = null;
    if (identity.season !== null && identity.episode !== null) {
      episode = await requestTvEpisode(hit.id, identity.season, identity.episode);
    }
    return { kind: 'tv', hit, details, episode };
  }
  const search = await request('/search/movie', { query: identity.query, language: LANGUAGE, include_adult: false, region: REGION, year: identity.year || undefined });
  const hit = chooseBest(search.results, identity); if (!hit) return null;
  const details = await request(`/movie/${hit.id}`, { language: LANGUAGE, append_to_response: 'images' });
  return { kind: 'movie', hit, details, episode: null };
}

function metadataFrom(match, identity) {
  const d = match.details, e = match.episode;
  const release = match.kind === 'movie' ? d.release_date : (e?.air_date || d.first_air_date);
  return {
    mediaKind: match.kind, tmdbId: d.id, title: match.kind === 'movie' ? d.title : d.name,
    originalTitle: match.kind === 'movie' ? d.original_title : d.original_name,
    releaseDate: release || null, releaseYear: Number(String(release || '').slice(0, 4)) || null,
    overview: e?.overview || d.overview || null, tagline: d.tagline || null,
    posterPath: d.poster_path || null, backdropPath: d.backdrop_path || null, stillPath: e?.still_path || null,
    voteAverage: Number(e?.vote_average || d.vote_average) || null,
    genres: Array.isArray(d.genres) ? d.genres.map(g => ({ id: g.id, name: g.name })) : [], originalLanguage: d.original_language || null,
    seasonNumber: e?.season_number ?? identity.season, episodeNumber: e?.episode_number ?? identity.episode, episodeTitle: e?.name || null
  };
}

export async function enrichMedia(pool, media) {
  const identity = parseMediaIdentity(media), match = await lookup(identity);
  if (!match) {
    await pool.query(`UPDATE media SET media_kind=$2, season_number=$3, episode_number=$4, metadata_status='MISS', metadata_error=$5, metadata_updated_at=now() WHERE id=$1`, [media.id, identity.kind, identity.season, identity.episode, `Nessun match TMDB per: ${identity.query}`]);
    return { status: 'MISS', identity };
  }
  const m = metadataFrom(match, identity);
  await pool.query(`UPDATE media SET media_kind=$2, tmdb_id=$3, title=$4, original_title=$5, release_date=$6, release_year=$7, overview=$8, tagline=$9, poster_path=$10, backdrop_path=$11, still_path=$12, vote_average=$13, genres=$14::jsonb, original_language=$15, season_number=$16, episode_number=$17, episode_title=$18, metadata_status='READY', metadata_error=NULL, metadata_updated_at=now() WHERE id=$1`, [media.id, m.mediaKind, m.tmdbId, m.title, m.originalTitle, m.releaseDate, m.releaseYear, m.overview, m.tagline, m.posterPath, m.backdropPath, m.stillPath, m.voteAverage, JSON.stringify(m.genres), m.originalLanguage, m.seasonNumber, m.episodeNumber, m.episodeTitle]);
  return { status: 'READY', identity, metadata: m };
}

export function createMetadataState() { return { configured: tmdbConfigured(), running: false, total: 0, processed: 0, matched: 0, missed: 0, errors: 0, current: null, startedAt: null, finishedAt: null, lastError: null }; }

export async function enrichLibrary({ pool, limit = 0, force = false, state = createMetadataState() }) {
  if (!tmdbConfigured()) throw new Error('TMDB_API_TOKEN non configurato');
  if (state.running) throw new Error('arricchimento TMDB gia in esecuzione');
  state.running = true; state.processed = 0; state.matched = 0; state.missed = 0; state.errors = 0; state.current = null; state.startedAt = new Date().toISOString(); state.finishedAt = null; state.lastError = null;
  try {
    const where = force ? `status='OK'` : `status='OK' AND metadata_status IN ('PENDING','MISS','ERROR')`;
    const count = await pool.query(`SELECT count(*)::int AS count FROM media WHERE ${where}`);
    state.total = limit > 0 ? Math.min(count.rows[0].count, limit) : count.rows[0].count;
    const rows = await pool.query(`SELECT id, relative_path, filename FROM media WHERE ${where} ORDER BY relative_path LIMIT $1`, [limit > 0 ? limit : 100000]);
    for (const media of rows.rows) {
      state.current = media.relative_path;
      try { const result = await enrichMedia(pool, media); if (result.status === 'READY') state.matched++; else state.missed++; }
      catch (error) { state.errors++; state.lastError = String(error?.message || error); await pool.query(`UPDATE media SET metadata_status='ERROR', metadata_error=$2, metadata_updated_at=now() WHERE id=$1`, [media.id, state.lastError.slice(0, 1000)]).catch(() => {}); }
      finally { state.processed++; }
    }
    return { ...state };
  } finally { state.running = false; state.current = null; state.finishedAt = new Date().toISOString(); }
}
import path from 'node:path';
import { resolveTmdbSeasonEpisode } from './tmdb.mjs';

const TMDB_ROOT = 'https://api.themoviedb.org/3';
const TMDB_TOKEN = String(process.env.TMDB_API_TOKEN || process.env.TMDB_BEARER_TOKEN || '').trim();
const TMDB_LANGUAGE = process.env.TMDB_LANGUAGE || 'it-IT';
const TMDB_REGION = process.env.TMDB_REGION || 'IT';
const TMDB_DELAY_MS = Math.max(0, Number(process.env.TMDB_DELAY_MS || 220));
const TVMAZE_ENABLED = String(process.env.TVMAZE_ENABLED || 'true').toLowerCase() !== 'false';
const TVMAZE_DELAY_MS = Math.max(500, Number(process.env.TVMAZE_DELAY_MS || 550));
const OMDB_API_KEY = String(process.env.OMDB_API_KEY || '').trim();
const ANILIST_ENABLED = String(process.env.ANILIST_ENABLED || 'true').toLowerCase() !== 'false';
const ANILIST_DELAY_MS = Math.max(2100, Number(process.env.ANILIST_DELAY_MS || 2200));
const AUTO_THRESHOLD = Math.max(55, Math.min(98, Number(process.env.METADATA_AUTO_CONFIDENCE || 74)));
const REVIEW_THRESHOLD = Math.max(25, Math.min(AUTO_THRESHOLD - 1, Number(process.env.METADATA_REVIEW_CONFIDENCE || 48)));
const SERIES_ALIASES = new Map([
  ['op2', 'One Piece']
]);

const clocks = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Number(n || 0)));

async function throttle(key, delay) {
  const previous = clocks.get(key) || 0;
  const wait = Math.max(0, delay - (Date.now() - previous));
  if (wait) await sleep(wait);
  clocks.set(key, Date.now());
}

export function rescueProviderConfig() {
  return {
    tmdb: Boolean(TMDB_TOKEN),
    tvmaze: TVMAZE_ENABLED,
    omdb: Boolean(OMDB_API_KEY),
    anilist: ANILIST_ENABLED,
    autoThreshold: AUTO_THRESHOLD,
    reviewThreshold: REVIEW_THRESHOLD
  };
}

export function normalizeTitle(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function seriesAlias(value = '') {
  return SERIES_ALIASES.get(normalizeTitle(value)) || value;
}

function releaseYear(value = '') {
  const m = String(value).match(/(?:^|[^0-9])((?:19|20)\d{2})(?:[^0-9]|$)/);
  return m ? Number(m[1]) : null;
}

function seasonEpisode(relativePath = '', filename = '') {
  const all = `${relativePath} ${filename}`;
  let m = all.match(/\bS(\d{1,3})[ ._-]*E(?:P)?(\d{1,4})\b/i);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  m = all.match(/\b(\d{1,3})x(\d{1,4})\b/i);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  const sf = String(relativePath).match(/(?:^|[\\/])(?:S|Season[ ._-]*)(\d{1,3})(?:[\\/]|$)/i);
  const ep = String(filename).match(/(?:^|\b)E(?:P)?[ ._-]?(\d{2,4})(?:\b|[^0-9])/i);
  if (sf && ep) return { season: Number(sf[1]), episode: Number(ep[1]) };
  const bareAbsoluteEpisode = path.basename(String(filename), path.extname(String(filename))).match(/\s-\s*(\d{3,4})(?=\s*(?:[\[(]|$))/);
  if (sf && bareAbsoluteEpisode) return { season: Number(sf[1]), episode: Number(bareAbsoluteEpisode[1]) };
  return null;
}

function cleanReleaseTitle(raw = '') {
  let value = path.basename(String(raw), path.extname(String(raw)));
  value = value
    .replace(/[\[\{][^\]\}]*[\]\}]/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\bS\d{1,3}[ ._-]*E(?:P)?\d{1,4}\b/ig, ' ')
    .replace(/\b\d{1,3}x\d{1,4}\b/ig, ' ')
    .replace(/\bE(?:P)?[ ._-]?\d{2,4}\b/ig, ' ')
    .replace(/\b(?:2160p|1080p|720p|576p|480p|4320p|4k|8k|uhd|bluray|blu ray|brrip|bdrip|webrip|web dl|webdl|web|hdtv|remux|dvdrip|hdr10\+?|hdr|dovi|dolby vision|xvid|divx|h264|h 264|h265|h 265|x264|x265|hevc|av1|aac|ac3|eac3|ddp|dts(?: hd)?|truehd|atmos|flac|ita|italian|eng|english|multi|multisub|sub|subs|proper|repack|extended|unrated|mirc(?:rew)?)\b/ig, ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\b(?:10bit|8bit|5 1|7 1|2 0)\b/ig, ' ')
    .replace(/[()]+/g, ' ')
    .replace(/\s+-\s+[^-]{1,24}$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return value;
}

function usefulFolder(folder = '') {
  const n = normalizeTitle(folder);
  if (!n || /^(media|film|films|movie|movies|serie|series|tv|anime|animazione|cartoni|cartoons|video|4k|uhd|hd|s\d+|season \d+)$/.test(n)) return false;
  return !/^\d+$/.test(n);
}

export function buildIdentityCandidates(media = {}) {
  const relative = String(media.relative_path || media.filename || '');
  const filename = String(media.filename || path.basename(relative));
  const parts = relative.split(/[\\/]/).filter(Boolean);
  const se = seasonEpisode(relative, filename);
  const year = releaseYear(filename) || releaseYear(relative);
  const raw = [];
  const rootAlias = parts[0] ? SERIES_ALIASES.get(normalizeTitle(parts[0])) : null;
  if (rootAlias) raw.push(rootAlias);

  if (se) {
    const seasonIndex = parts.findIndex(p => /^(?:S\d{1,3}|Season[ ._-]*\d{1,3})$/i.test(p));
    if (seasonIndex > 0) raw.push(seriesAlias(parts[seasonIndex - 1]));
    const prefix = filename.split(/\bS\d{1,3}[ ._-]*E(?:P)?\d{1,4}\b|\b\d{1,3}x\d{1,4}\b|\bE(?:P)?[ ._-]?\d{2,4}\b/i)[0];
    if (prefix) raw.push(prefix);
  }

  raw.push(filename);
  for (let i = Math.max(0, parts.length - 4); i < Math.max(0, parts.length - 1); i++) {
    if (usefulFolder(parts[i])) raw.push(seriesAlias(parts[i]));
  }

  const queries = [...new Set(raw.map(cleanReleaseTitle).map(s => s.trim()).filter(s => s.length >= 2))];
  const kind = se ? 'tv' : 'movie';
  const lowerPath = normalizeTitle(`${relative} ${queries.join(' ')}`);
  const animeLikely = kind === 'tv' && (
    /\b(anime|one piece|dragon ball|naruto|bleach|pokemon|demon slayer|kimetsu|jujutsu|attack on titan|shingeki|my hero academia|boku no hero)\b/.test(lowerPath) ||
    Number(se?.episode || 0) >= 100
  );

  return {
    kind,
    queries,
    query: queries[0] || cleanReleaseTitle(filename),
    year,
    season: se?.season ?? null,
    episode: se?.episode ?? null,
    animeLikely
  };
}

function levenshtein(a, b) {
  a = normalizeTitle(a); b = normalizeTitle(b);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

export function matchConfidence(query, candidate, year = null, candidateYear = null) {
  const q = normalizeTitle(query), c = normalizeTitle(candidate);
  if (!q || !c) return 0;
  let score = 0;
  if (q === c) score = 88;
  else {
    const qWords = new Set(q.split(' ').filter(Boolean));
    const cWords = new Set(c.split(' ').filter(Boolean));
    const intersection = [...qWords].filter(w => cWords.has(w)).length;
    const union = new Set([...qWords, ...cWords]).size || 1;
    const jaccard = intersection / union;
    const edit = 1 - levenshtein(q, c) / Math.max(q.length, c.length, 1);
    score = Math.max(jaccard * 78, edit * 72);
    if (q.startsWith(c) || c.startsWith(q)) score = Math.max(score, 72);
    if (q.includes(c) || c.includes(q)) score = Math.max(score, 67);
  }
  if (year && candidateYear) {
    const diff = Math.abs(Number(year) - Number(candidateYear));
    if (diff === 0) score += 10;
    else if (diff === 1) score += 4;
    else if (diff >= 3) score -= 12;
  }
  return Math.round(clamp(score));
}

async function tmdbRequest(endpoint, params = {}) {
  if (!TMDB_TOKEN) throw new Error('TMDB_API_TOKEN non configurato');
  await throttle('tmdb', TMDB_DELAY_MS);
  const url = new URL(`${TMDB_ROOT}${endpoint}`);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: 'application/json' },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`TMDB ${response.status}: ${(await response.text()).slice(0, 240)}`);
  return response.json();
}

async function tvmazeRequest(endpoint, params = {}) {
  if (!TVMAZE_ENABLED) return null;
  await throttle('tvmaze', TVMAZE_DELAY_MS);
  const url = new URL(`https://api.tvmaze.com${endpoint}`);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`TVmaze ${response.status}: ${(await response.text()).slice(0, 240)}`);
  return response.json();
}

async function omdbRequest(params = {}) {
  if (!OMDB_API_KEY) return null;
  const url = new URL('https://www.omdbapi.com/');
  url.searchParams.set('apikey', OMDB_API_KEY);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`OMDb ${response.status}`);
  const data = await response.json();
  return data.Response === 'False' ? null : data;
}

async function anilistRequest(query, variables = {}) {
  if (!ANILIST_ENABLED) return null;
  await throttle('anilist', ANILIST_DELAY_MS);
  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`AniList ${response.status}`);
  const data = await response.json();
  if (data.errors?.length) throw new Error(`AniList: ${data.errors[0].message}`);
  return data.data;
}

function tmdbCandidate(item, kind, query, identity) {
  const title = kind === 'movie' ? (item.title || item.original_title) : (item.name || item.original_name);
  const year = Number(String(kind === 'movie' ? item.release_date : item.first_air_date).slice(0, 4)) || null;
  return {
    provider: 'tmdb', id: Number(item.id), kind, title, year,
    confidence: matchConfidence(query, title, identity.year, year),
    poster_url: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
    external: {}
  };
}

async function searchTmdb(identity, maxPerKind = 5) {
  if (!TMDB_TOKEN) return [];
  const result = [];
  const seen = new Set();
  const kinds = identity.kind === 'tv' ? ['tv', 'movie'] : ['movie', 'tv'];
  for (const query of identity.queries.slice(0, 3)) {
    for (const kind of kinds) {
      const params = { query, language: TMDB_LANGUAGE, include_adult: false };
      if (identity.year) params[kind === 'movie' ? 'year' : 'first_air_date_year'] = identity.year;
      const data = await tmdbRequest(`/search/${kind}`, params);
      for (const item of (data.results || []).slice(0, maxPerKind)) {
        const key = `${kind}:${item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(tmdbCandidate(item, kind, query, identity));
      }
    }
  }
  return result.sort((a, b) => b.confidence - a.confidence);
}

async function tmdbFind(externalId, source, preferredKind = 'tv') {
  if (!TMDB_TOKEN || !externalId) return null;
  const data = await tmdbRequest(`/find/${encodeURIComponent(externalId)}`, { external_source: source, language: TMDB_LANGUAGE });
  const order = preferredKind === 'movie' ? ['movie_results', 'tv_results'] : ['tv_results', 'movie_results'];
  for (const key of order) {
    const item = data[key]?.[0];
    if (item) return { kind: key.startsWith('movie') ? 'movie' : 'tv', id: Number(item.id) };
  }
  return null;
}

async function tmdbMetadata(id, kind, identity) {
  const details = await tmdbRequest(`/${kind}/${id}`, { language: TMDB_LANGUAGE, append_to_response: 'external_ids' });
  let episode = null;
  if (kind === 'tv' && identity.season != null && identity.episode != null) {
    try {
      episode = await tmdbRequest(`/tv/${id}/season/${identity.season}/episode/${identity.episode}`, { language: TMDB_LANGUAGE });
    } catch {
      try {
        const season = await tmdbRequest(`/tv/${id}/season/${identity.season}`, { language: TMDB_LANGUAGE });
        episode = resolveTmdbSeasonEpisode(season?.episodes, identity.episode);
      } catch {}
    }
  }
  const release = kind === 'movie' ? details.release_date : (episode?.air_date || details.first_air_date);
  return {
    mediaKind: kind,
    tmdbId: Number(details.id),
    title: kind === 'movie' ? details.title : details.name,
    originalTitle: kind === 'movie' ? details.original_title : details.original_name,
    releaseDate: release || null,
    releaseYear: Number(String(release || '').slice(0, 4)) || null,
    overview: episode?.overview || details.overview || null,
    tagline: details.tagline || null,
    posterPath: details.poster_path || null,
    backdropPath: details.backdrop_path || null,
    stillPath: episode?.still_path || null,
    voteAverage: Number(episode?.vote_average || details.vote_average) || null,
    genres: Array.isArray(details.genres) ? details.genres.map(g => ({ id: g.id, name: g.name })) : [],
    originalLanguage: details.original_language || null,
    seasonNumber: episode?.season_number ?? identity.season,
    episodeNumber: episode?.episode_number ?? identity.episode,
    episodeTitle: episode?.name || (identity.episode != null ? `Episodio ${identity.episode}` : null),
    external: {
      imdb: details.external_ids?.imdb_id || details.imdb_id || null,
      tvdb: details.external_ids?.tvdb_id || null
    }
  };
}

function stripHtml(value = '') {
  return String(value).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

async function searchTvmaze(identity) {
  if (!TVMAZE_ENABLED || identity.kind !== 'tv') return [];
  const out = [], seen = new Set();
  for (const query of identity.queries.slice(0, 3)) {
    const data = await tvmazeRequest('/search/shows', { q: query });
    for (const item of (data || []).slice(0, 7)) {
      const show = item.show || {};
      if (!show.id || seen.has(show.id)) continue;
      seen.add(show.id);
      const year = Number(String(show.premiered || '').slice(0, 4)) || null;
      out.push({
        provider: 'tvmaze', id: Number(show.id), kind: 'tv', title: show.name, year,
        confidence: Math.round(clamp(matchConfidence(query, show.name, identity.year, year) * 0.85 + clamp(Number(item.score || 0) * 100) * 0.15)),
        poster_url: show.image?.medium || show.image?.original || null,
        external: { imdb: show.externals?.imdb || null, tvdb: show.externals?.thetvdb || null },
        raw: show
      });
    }
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

async function tvmazeMetadata(candidate, identity) {
  const show = candidate.raw || await tvmazeRequest(`/shows/${candidate.id}`);
  let episode = null;
  if (identity.season != null && identity.episode != null) {
    try { episode = await tvmazeRequest(`/shows/${candidate.id}/episodebynumber`, { season: identity.season, number: identity.episode }); } catch {}
  }
  const release = episode?.airdate || show?.premiered || null;
  return {
    mediaKind: 'tv', tmdbId: null, title: show?.name || candidate.title, originalTitle: show?.name || candidate.title,
    releaseDate: release, releaseYear: Number(String(release || '').slice(0, 4)) || null,
    overview: stripHtml(episode?.summary || show?.summary || ''), tagline: null,
    posterPath: show?.image?.original || show?.image?.medium || null,
    backdropPath: show?.image?.original || null, stillPath: episode?.image?.original || episode?.image?.medium || null,
    voteAverage: Number(episode?.rating?.average || show?.rating?.average) || null,
    genres: (show?.genres || []).map(name => ({ name })), originalLanguage: show?.language || null,
    seasonNumber: identity.season, episodeNumber: identity.episode,
    episodeTitle: episode?.name || (identity.episode != null ? `Episodio ${identity.episode}` : null),
    external: { imdb: show?.externals?.imdb || null, tvdb: show?.externals?.thetvdb || null, tvmaze: Number(show?.id || candidate.id) }
  };
}

async function searchOmdb(identity) {
  if (!OMDB_API_KEY) return [];
  const out = [];
  for (const query of identity.queries.slice(0, 3)) {
    const data = await omdbRequest({ t: query, y: identity.year || undefined, type: identity.kind === 'tv' ? 'series' : 'movie', plot: 'full' });
    if (!data?.imdbID) continue;
    const year = Number(String(data.Year || '').match(/\d{4}/)?.[0]) || null;
    out.push({ provider: 'omdb', id: data.imdbID, kind: identity.kind, title: data.Title, year,
      confidence: matchConfidence(query, data.Title, identity.year, year), poster_url: data.Poster && data.Poster !== 'N/A' ? data.Poster : null,
      external: { imdb: data.imdbID }, raw: data });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

function omdbMetadata(candidate, identity) {
  const data = candidate.raw || {};
  return {
    mediaKind: identity.kind, tmdbId: null, title: data.Title || candidate.title, originalTitle: data.Title || candidate.title,
    releaseDate: data.Released && data.Released !== 'N/A' ? data.Released : null,
    releaseYear: Number(String(data.Year || candidate.year || '').match(/\d{4}/)?.[0]) || null,
    overview: data.Plot && data.Plot !== 'N/A' ? data.Plot : null, tagline: null,
    posterPath: data.Poster && data.Poster !== 'N/A' ? data.Poster : candidate.poster_url || null,
    backdropPath: null, stillPath: null,
    voteAverage: Number(data.imdbRating) || null,
    genres: String(data.Genre || '').split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name })),
    originalLanguage: String(data.Language || '').split(',')[0]?.trim() || null,
    seasonNumber: identity.season, episodeNumber: identity.episode,
    episodeTitle: identity.episode != null ? `Episodio ${identity.episode}` : null,
    external: { imdb: data.imdbID || candidate.id }
  };
}

const ANILIST_SEARCH = `query($search:String){Page(page:1,perPage:6){media(search:$search,type:ANIME){id idMal title{romaji english native} episodes startDate{year} format averageScore genres coverImage{extraLarge large} bannerImage}}}`;
const ANILIST_BY_ID = `query($id:Int){Media(id:$id,type:ANIME){id idMal title{romaji english native} episodes startDate{year month day} format averageScore genres description(asHtml:false) coverImage{extraLarge large} bannerImage}}`;

async function searchAnilist(identity) {
  if (!ANILIST_ENABLED || !identity.animeLikely) return [];
  const query = identity.queries[0];
  if (!query) return [];
  const data = await anilistRequest(ANILIST_SEARCH, { search: query });
  return (data?.Page?.media || []).map(item => {
    const names = [item.title?.english, item.title?.romaji, item.title?.native].filter(Boolean);
    let confidence = 0, matchedTitle = names[0] || query;
    for (const name of names) {
      const c = matchConfidence(query, name, identity.year, item.startDate?.year || null);
      if (c > confidence) { confidence = c; matchedTitle = name; }
    }
    return { provider: 'anilist', id: Number(item.id), kind: 'tv', title: matchedTitle, year: item.startDate?.year || null,
      confidence, poster_url: item.coverImage?.extraLarge || item.coverImage?.large || null, external: { anilist: Number(item.id), mal: item.idMal || null }, raw: item };
  }).sort((a, b) => b.confidence - a.confidence);
}

async function anilistMetadata(candidate, identity) {
  const data = candidate.raw?.description !== undefined ? candidate.raw : (await anilistRequest(ANILIST_BY_ID, { id: Number(candidate.id) }))?.Media;
  const title = data?.title?.english || data?.title?.romaji || data?.title?.native || candidate.title;
  const date = data?.startDate?.year ? `${data.startDate.year}-${String(data.startDate.month || 1).padStart(2,'0')}-${String(data.startDate.day || 1).padStart(2,'0')}` : null;
  return {
    mediaKind: 'tv', tmdbId: null, title, originalTitle: data?.title?.romaji || title,
    releaseDate: date, releaseYear: data?.startDate?.year || null,
    overview: stripHtml(data?.description || ''), tagline: null,
    posterPath: data?.coverImage?.extraLarge || data?.coverImage?.large || candidate.poster_url || null,
    backdropPath: data?.bannerImage || null, stillPath: null,
    voteAverage: data?.averageScore ? Number(data.averageScore) / 10 : null,
    genres: (data?.genres || []).map(name => ({ name })), originalLanguage: 'ja',
    seasonNumber: identity.season, episodeNumber: identity.episode,
    episodeTitle: identity.episode != null ? `Episodio ${identity.episode}` : null,
    external: { anilist: Number(data?.id || candidate.id), mal: data?.idMal || null }
  };
}

async function persistMetadata(pool, mediaId, metadata, { provider, confidence, locked = false, attempts = [] } = {}) {
  const e = metadata.external || {};
  await pool.query(`
    UPDATE media SET
      media_kind=$2, tmdb_id=$3, title=$4, original_title=$5,
      release_date=$6, release_year=$7, overview=$8, tagline=$9,
      poster_path=$10, backdrop_path=$11, still_path=$12,
      vote_average=$13, genres=$14::jsonb, original_language=$15,
      season_number=$16, episode_number=$17, episode_title=$18,
      metadata_status='READY', metadata_error=NULL, metadata_updated_at=now(),
      metadata_provider=$19, metadata_confidence=$20,
      external_imdb_id=$21, external_tvdb_id=$22, external_tvmaze_id=$23, external_anilist_id=$24,
      metadata_locked=$25, metadata_attempts=$26::jsonb
    WHERE id=$1
  `, [mediaId, metadata.mediaKind, metadata.tmdbId, metadata.title, metadata.originalTitle,
    metadata.releaseDate, metadata.releaseYear, metadata.overview, metadata.tagline,
    metadata.posterPath, metadata.backdropPath, metadata.stillPath, metadata.voteAverage,
    JSON.stringify(metadata.genres || []), metadata.originalLanguage,
    metadata.seasonNumber, metadata.episodeNumber, metadata.episodeTitle,
    provider, Math.round(clamp(confidence)), e.imdb || null, e.tvdb ? String(e.tvdb) : null,
    e.tvmaze ? Number(e.tvmaze) : null, e.anilist ? Number(e.anilist) : null,
    Boolean(locked), JSON.stringify(attempts.slice(-50))]);
}

async function unresolved(pool, media, identity, attempts, bestConfidence = 0) {
  const status = bestConfidence >= REVIEW_THRESHOLD ? 'NEEDS_REVIEW' : 'MISS';
  await pool.query(`
    UPDATE media SET media_kind=$2, season_number=$3, episode_number=$4,
      metadata_status=$5, metadata_error=$6, metadata_confidence=$7,
      metadata_provider=NULL, metadata_attempts=$8::jsonb, metadata_updated_at=now()
    WHERE id=$1
  `, [media.id, identity.kind, identity.season, identity.episode, status,
    status === 'NEEDS_REVIEW' ? 'Match possibili trovati, serve conferma.' : `Nessun match affidabile per: ${identity.query}`,
    Math.round(bestConfidence), JSON.stringify(attempts.slice(-50))]);
  return { status, identity, confidence: Math.round(bestConfidence), attempts };
}

function attempt(provider, candidate, query) {
  return { provider, query, title: candidate?.title || null, id: candidate?.id || null, confidence: candidate?.confidence || 0 };
}

async function acceptCandidate(pool, media, identity, candidate, attempts, locked = false) {
  let metadata = null;
  let provider = candidate.provider;

  if (candidate.provider === 'tmdb') {
    metadata = await tmdbMetadata(candidate.id, candidate.kind, identity);
  } else if (candidate.provider === 'tvmaze') {
    const imdb = candidate.external?.imdb;
    const tvdb = candidate.external?.tvdb;
    const tmdb = imdb ? await tmdbFind(imdb, 'imdb_id', 'tv') : (tvdb ? await tmdbFind(tvdb, 'tvdb_id', 'tv') : null);
    if (tmdb) {
      metadata = await tmdbMetadata(tmdb.id, tmdb.kind, identity);
      metadata.external = { ...(metadata.external || {}), tvmaze: candidate.id, imdb: metadata.external?.imdb || imdb || null, tvdb: metadata.external?.tvdb || tvdb || null };
      provider = 'tvmaze→tmdb';
    } else metadata = await tvmazeMetadata(candidate, identity);
  } else if (candidate.provider === 'omdb') {
    const tmdb = candidate.external?.imdb ? await tmdbFind(candidate.external.imdb, 'imdb_id', identity.kind) : null;
    if (tmdb) {
      metadata = await tmdbMetadata(tmdb.id, tmdb.kind, identity);
      metadata.external = { ...(metadata.external || {}), imdb: candidate.external.imdb };
      provider = 'omdb→tmdb';
    } else {
      if (!candidate.raw) candidate.raw = await omdbRequest({ i: candidate.id, plot: 'full' });
      metadata = omdbMetadata(candidate, identity);
    }
  } else if (candidate.provider === 'anilist') {
    metadata = await anilistMetadata(candidate, identity);
  }

  if (!metadata) throw new Error(`Provider non supportato: ${candidate.provider}`);
  await persistMetadata(pool, media.id, metadata, { provider: locked ? `manual:${provider}` : provider, confidence: locked ? 100 : candidate.confidence, locked, attempts });
  return { status: 'READY', provider, confidence: locked ? 100 : candidate.confidence, metadata };
}

export async function rescueMedia(pool, media, { force = false } = {}) {
  if (media.metadata_locked && !force) return { status: 'LOCKED' };
  const identity = buildIdentityCandidates(media);
  const attempts = [];
  let bestConfidence = 0;

  const tmdb = await searchTmdb(identity);
  for (const c of tmdb.slice(0, 5)) attempts.push(attempt('tmdb', c, identity.query));
  if (tmdb[0]) bestConfidence = Math.max(bestConfidence, tmdb[0].confidence);
  if (tmdb[0]?.confidence >= AUTO_THRESHOLD) return acceptCandidate(pool, media, identity, tmdb[0], attempts);

  const tvmaze = await searchTvmaze(identity);
  for (const c of tvmaze.slice(0, 5)) attempts.push(attempt('tvmaze', c, identity.query));
  if (tvmaze[0]) bestConfidence = Math.max(bestConfidence, tvmaze[0].confidence);
  if (tvmaze[0]?.confidence >= AUTO_THRESHOLD) return acceptCandidate(pool, media, identity, tvmaze[0], attempts);

  const omdb = await searchOmdb(identity);
  for (const c of omdb.slice(0, 3)) attempts.push(attempt('omdb', c, identity.query));
  if (omdb[0]) bestConfidence = Math.max(bestConfidence, omdb[0].confidence);
  if (omdb[0]?.confidence >= AUTO_THRESHOLD) return acceptCandidate(pool, media, identity, omdb[0], attempts);

  const anilist = await searchAnilist(identity);
  for (const c of anilist.slice(0, 5)) attempts.push(attempt('anilist', c, identity.query));
  if (anilist[0]) bestConfidence = Math.max(bestConfidence, anilist[0].confidence);
  if (anilist[0]?.confidence >= AUTO_THRESHOLD) return acceptCandidate(pool, media, identity, anilist[0], attempts);

  return unresolved(pool, media, identity, attempts, bestConfidence);
}

export function createRescueState() {
  return {
    running: false, total: 0, processed: 0, rescued: 0, review: 0, missed: 0, errors: 0,
    providerCounts: {}, current: null, startedAt: null, finishedAt: null, lastError: null
  };
}

export async function rescueLibrary({ pool, limit = 0, force = false, state = createRescueState() }) {
  if (state.running) throw new Error('Metadata Rescue gia in esecuzione');
  state.running = true; state.processed = 0; state.rescued = 0; state.review = 0; state.missed = 0; state.errors = 0;
  state.providerCounts = {}; state.current = null; state.startedAt = new Date().toISOString(); state.finishedAt = null; state.lastError = null;
  try {
    const where = force
      ? `status='OK' AND metadata_locked=false`
      : `status='OK' AND metadata_locked=false AND metadata_status IN ('MISS','ERROR','NEEDS_REVIEW')`;
    const count = await pool.query(`SELECT count(*)::int AS count FROM media WHERE ${where}`);
    state.total = limit > 0 ? Math.min(Number(count.rows[0].count), limit) : Number(count.rows[0].count);
    const rows = await pool.query(`SELECT * FROM media WHERE ${where} ORDER BY relative_path LIMIT $1`, [limit > 0 ? limit : 100000]);
    for (const media of rows.rows) {
      state.current = media.relative_path;
      try {
        const result = await rescueMedia(pool, media, { force });
        if (result.status === 'READY') {
          state.rescued++;
          state.providerCounts[result.provider] = (state.providerCounts[result.provider] || 0) + 1;
        } else if (result.status === 'NEEDS_REVIEW') state.review++;
        else if (result.status === 'MISS') state.missed++;
      } catch (error) {
        state.errors++; state.lastError = String(error?.message || error);
        await pool.query(`UPDATE media SET metadata_status='ERROR', metadata_error=$2, metadata_updated_at=now() WHERE id=$1`, [media.id, state.lastError.slice(0, 1000)]).catch(() => {});
      } finally { state.processed++; }
    }
    return { ...state };
  } finally {
    state.running = false; state.current = null; state.finishedAt = new Date().toISOString();
  }
}

export async function listMetadataReview(pool, { limit = 50, offset = 0 } = {}) {
  const count = await pool.query(`SELECT count(*)::int AS count FROM media WHERE status='OK' AND metadata_status IN ('MISS','ERROR','NEEDS_REVIEW')`);
  const rows = await pool.query(`
    SELECT id, relative_path, filename, media_kind, metadata_status, metadata_error,
      metadata_confidence, metadata_provider, metadata_attempts, metadata_locked,
      season_number, episode_number
    FROM media
    WHERE status='OK' AND metadata_status IN ('MISS','ERROR','NEEDS_REVIEW')
    ORDER BY CASE metadata_status WHEN 'NEEDS_REVIEW' THEN 0 WHEN 'MISS' THEN 1 ELSE 2 END,
      metadata_confidence DESC NULLS LAST, relative_path
    LIMIT $1 OFFSET $2
  `, [Math.max(1, Math.min(100, Number(limit || 50))), Math.max(0, Number(offset || 0))]);
  return { count: Number(count.rows[0].count), items: rows.rows.map(row => ({ ...row, identity: buildIdentityCandidates(row) })) };
}

export async function searchMetadataCandidates(media, queryOverride = '') {
  const identity = buildIdentityCandidates(media);
  const manualQuery = String(queryOverride).trim();
  if (manualQuery) {
    identity.queries = [manualQuery];
    identity.query = manualQuery;
    identity.year = null;
  }
  const all = [];
  try { all.push(...(await searchTmdb(identity)).slice(0, 8)); } catch {}
  try { all.push(...(await searchTvmaze(identity)).slice(0, 6)); } catch {}
  try { all.push(...(await searchOmdb(identity)).slice(0, 3)); } catch {}
  try { all.push(...(await searchAnilist(identity)).slice(0, 6)); } catch {}
  const unique = new Map();
  for (const item of all) {
    const key = `${item.provider}:${item.id}`;
    if (!unique.has(key) || unique.get(key).confidence < item.confidence) unique.set(key, item);
  }
  return [...unique.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 20).map(({ raw, ...item }) => item);
}

export async function applyMetadataCandidate(pool, media, candidate) {
  if (!candidate?.provider || candidate.id == null) throw new Error('candidate provider/id mancanti');
  const identity = buildIdentityCandidates(media);
  const hydrated = { ...candidate, confidence: 100, external: candidate.external || {} };
  if (candidate.provider === 'tvmaze') hydrated.raw = await tvmazeRequest(`/shows/${candidate.id}`);
  if (candidate.provider === 'omdb') hydrated.raw = await omdbRequest({ i: candidate.id, plot: 'full' });
  return acceptCandidate(pool, media, identity, hydrated, [{ provider: 'manual', id: candidate.id, title: candidate.title || null, confidence: 100 }], true);
}

export async function unlockMetadata(pool, mediaId) {
  const result = await pool.query(`UPDATE media SET metadata_locked=false WHERE id=$1 RETURNING id`, [mediaId]);
  return Boolean(result.rowCount);
}
const POSTER = 'https://image.tmdb.org/t/p/w500';
const BACKDROP = 'https://image.tmdb.org/t/p/w1280';
const STILL = 'https://image.tmdb.org/t/p/w780';

function artwork(base, value) {
  if (!value) return null;
  if (/^https?:\/\//i.test(String(value))) return String(value);
  return `${base}${value}`;
}

export function decorateMedia(row = {}) {
  const progress = Number(row.position_seconds || 0);
  const duration = Number(row.progress_duration || row.progress_duration_seconds || row.duration_seconds || 0);
  return {
    ...row,
    display_title: row.episode_title || row.title || row.filename,
    display_subtitle: row.media_kind === 'tv' && row.title
      ? `${row.title}${row.season_number != null && row.episode_number != null ? ` · S${String(row.season_number).padStart(2,'0')}E${String(row.episode_number).padStart(2,'0')}` : ''}`
      : (row.release_year || ''),
    poster_url: artwork(POSTER, row.poster_path),
    backdrop_url: row.still_path ? artwork(STILL, row.still_path) : artwork(BACKDROP, row.backdrop_path),
    progress_seconds: progress,
    progress_percent: duration > 0 ? Math.max(0, Math.min(100, progress / duration * 100)) : 0
  };
}

const cardColumns = `
  m.id, m.relative_path, m.filename, m.extension, m.duration_seconds, m.bitrate_bps,
  m.width, m.height, m.video_codec, m.video_profile, m.bit_depth, m.hdr, m.status,
  m.media_kind, m.tmdb_id, m.title, m.original_title, m.release_date, m.release_year,
  m.overview, m.tagline, m.poster_path, m.backdrop_path, m.still_path,
  m.vote_average, m.genres, m.original_language, m.season_number, m.episode_number,
  m.episode_title, m.metadata_status, m.metadata_provider, m.metadata_confidence,
  m.external_imdb_id, m.external_tvdb_id, m.external_tvmaze_id, m.external_anilist_id,
  m.metadata_locked, m.updated_at,
  p.position_seconds, p.duration_seconds AS progress_duration, p.completed, p.updated_at AS progress_updated_at
`;

async function rows(pool, sql, args = []) {
  const result = await pool.query(sql, args);
  return result.rows.map(decorateMedia);
}

export async function getHome(pool, profileId = 'default') {
  const join = `LEFT JOIN playback_progress p ON p.media_id=m.id AND p.profile_id=$1`;
  const heroRows = await rows(pool, `
    SELECT ${cardColumns}
    FROM media m ${join}
    WHERE m.status='OK' AND m.backdrop_path IS NOT NULL
    ORDER BY
      CASE WHEN p.position_seconds > 30 AND p.completed=false THEN 0 ELSE 1 END,
      m.vote_average DESC NULLS LAST,
      m.metadata_updated_at DESC NULLS LAST
    LIMIT 8
  `, [profileId]);

  const continueWatching = await rows(pool, `
    SELECT ${cardColumns}
    FROM media m ${join}
    WHERE m.status='OK' AND p.position_seconds > 30 AND p.completed=false
      AND (p.duration_seconds <= 0 OR p.position_seconds < p.duration_seconds - 60)
    ORDER BY p.updated_at DESC
    LIMIT 20
  `, [profileId]);

  const recent = await rows(pool, `
    SELECT ${cardColumns}
    FROM media m ${join}
    WHERE m.status='OK'
    ORDER BY m.updated_at DESC
    LIMIT 24
  `, [profileId]);

  const movies = await rows(pool, `
    SELECT ${cardColumns}
    FROM media m ${join}
    WHERE m.status='OK' AND m.media_kind='movie'
    ORDER BY COALESCE(m.release_year,0) DESC, m.vote_average DESC NULLS LAST
    LIMIT 24
  `, [profileId]);

  const series = await rows(pool, `
    SELECT DISTINCT ON (COALESCE(m.tmdb_id, m.external_tvmaze_id, m.external_anilist_id, m.id::int)) ${cardColumns}
    FROM media m ${join}
    WHERE m.status='OK' AND m.media_kind='tv'
    ORDER BY COALESCE(m.tmdb_id, m.external_tvmaze_id, m.external_anilist_id, m.id::int), m.season_number DESC NULLS LAST, m.episode_number DESC NULLS LAST, m.updated_at DESC
  `, [profileId]);

  const fourK = await rows(pool, `
    SELECT ${cardColumns}
    FROM media m ${join}
    WHERE m.status='OK' AND m.width >= 3000
    ORDER BY m.vote_average DESC NULLS LAST, m.updated_at DESC
    LIMIT 20
  `, [profileId]);

  const hdr = await rows(pool, `
    SELECT ${cardColumns}
    FROM media m ${join}
    WHERE m.status='OK' AND COALESCE(m.hdr,'SDR') <> 'SDR'
    ORDER BY m.vote_average DESC NULLS LAST, m.updated_at DESC
    LIMIT 20
  `, [profileId]);

  return {
    hero: heroRows[0] || recent[0] || null,
    heroCandidates: heroRows,
    rails: [
      continueWatching.length ? { id: 'continue', title: 'Continua a guardare', eyebrow: 'RIPRENDI', items: continueWatching } : null,
      { id: 'recent', title: 'Aggiunti di recente', eyebrow: 'NUOVI ARRIVI', items: recent },
      movies.length ? { id: 'movies', title: 'Film', eyebrow: 'CINEMA', items: movies } : null,
      series.length ? { id: 'series', title: 'Serie', eyebrow: 'EPISODI', items: series.slice(0, 24) } : null,
      fourK.length ? { id: '4k', title: 'Ultra HD', eyebrow: '4K', items: fourK } : null,
      hdr.length ? { id: 'hdr', title: 'HDR & Dolby Vision', eyebrow: 'HIGH DYNAMIC RANGE', items: hdr } : null
    ].filter(Boolean)
  };
}

export async function searchLibrary(pool, query, profileId = 'default', limit = 50) {
  const q = `%${String(query || '').trim()}%`;
  if (q === '%%') return [];
  return rows(pool, `
    SELECT ${cardColumns}
    FROM media m
    LEFT JOIN playback_progress p ON p.media_id=m.id AND p.profile_id=$1
    WHERE m.status='OK' AND (
      COALESCE(m.title,'') ILIKE $2 OR COALESCE(m.original_title,'') ILIKE $2 OR
      COALESCE(m.episode_title,'') ILIKE $2 OR m.filename ILIKE $2 OR m.relative_path ILIKE $2
    )
    ORDER BY CASE WHEN COALESCE(m.title,m.filename) ILIKE $3 THEN 0 ELSE 1 END,
             m.vote_average DESC NULLS LAST, m.updated_at DESC
    LIMIT $4
  `, [profileId, q, `${String(query || '').trim()}%`, limit]);
}

export async function saveProgress(pool, mediaId, profileId, { positionSeconds = 0, durationSeconds = 0, completed = false } = {}) {
  const position = Math.max(0, Number(positionSeconds || 0));
  const duration = Math.max(0, Number(durationSeconds || 0));
  const done = Boolean(completed || (duration > 0 && position >= duration - 45));
  await pool.query(`
    INSERT INTO playback_progress(profile_id, media_id, position_seconds, duration_seconds, completed, updated_at)
    VALUES($1,$2,$3,$4,$5,now())
    ON CONFLICT(profile_id,media_id) DO UPDATE SET
      position_seconds=EXCLUDED.position_seconds,
      duration_seconds=EXCLUDED.duration_seconds,
      completed=EXCLUDED.completed,
      updated_at=now()
  `, [profileId, mediaId, position, duration, done]);
  return { positionSeconds: position, durationSeconds: duration, completed: done };
}

export async function getProgress(pool, mediaId, profileId) {
  const result = await pool.query(`SELECT position_seconds, duration_seconds, completed, updated_at FROM playback_progress WHERE profile_id=$1 AND media_id=$2`, [profileId, mediaId]);
  return result.rows[0] || { position_seconds: 0, duration_seconds: 0, completed: false };
}

import pg from 'pg';

const { Pool } = pg;

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (connectionString) {
    return new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });
  }

  const { POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD } = process.env;
  if (!POSTGRES_DB || !POSTGRES_USER || !POSTGRES_PASSWORD) {
    throw new Error('POSTGRES_DB, POSTGRES_USER and POSTGRES_PASSWORD are required');
  }

  return new Pool({
    host: process.env.DB_HOST || 'postgres',
    port: Number(process.env.DB_PORT || 5432),
    database: POSTGRES_DB,
    user: POSTGRES_USER,
    password: POSTGRES_PASSWORD,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });
}

export async function initDb(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS media (
      id BIGSERIAL PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      relative_path TEXT NOT NULL,
      filename TEXT NOT NULL,
      extension TEXT,
      size_bytes BIGINT,
      container TEXT,
      duration_seconds DOUBLE PRECISION,
      bitrate_bps BIGINT,
      width INTEGER,
      height INTEGER,
      video_codec TEXT,
      video_profile TEXT,
      pixel_format TEXT,
      bit_depth INTEGER,
      hdr TEXT,
      color_transfer TEXT,
      status TEXT NOT NULL DEFAULT 'OK',
      probe_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const metadataColumns = [
    `ADD COLUMN IF NOT EXISTS media_kind TEXT`,
    `ADD COLUMN IF NOT EXISTS tmdb_id INTEGER`,
    `ADD COLUMN IF NOT EXISTS title TEXT`,
    `ADD COLUMN IF NOT EXISTS original_title TEXT`,
    `ADD COLUMN IF NOT EXISTS release_date TEXT`,
    `ADD COLUMN IF NOT EXISTS release_year INTEGER`,
    `ADD COLUMN IF NOT EXISTS overview TEXT`,
    `ADD COLUMN IF NOT EXISTS tagline TEXT`,
    `ADD COLUMN IF NOT EXISTS poster_path TEXT`,
    `ADD COLUMN IF NOT EXISTS backdrop_path TEXT`,
    `ADD COLUMN IF NOT EXISTS still_path TEXT`,
    `ADD COLUMN IF NOT EXISTS vote_average DOUBLE PRECISION`,
    `ADD COLUMN IF NOT EXISTS genres JSONB NOT NULL DEFAULT '[]'::jsonb`,
    `ADD COLUMN IF NOT EXISTS original_language TEXT`,
    `ADD COLUMN IF NOT EXISTS season_number INTEGER`,
    `ADD COLUMN IF NOT EXISTS episode_number INTEGER`,
    `ADD COLUMN IF NOT EXISTS episode_title TEXT`,
    `ADD COLUMN IF NOT EXISTS metadata_status TEXT NOT NULL DEFAULT 'PENDING'`,
    `ADD COLUMN IF NOT EXISTS metadata_error TEXT`,
    `ADD COLUMN IF NOT EXISTS metadata_updated_at TIMESTAMPTZ`,
    `ADD COLUMN IF NOT EXISTS metadata_provider TEXT`,
    `ADD COLUMN IF NOT EXISTS metadata_confidence INTEGER`,
    `ADD COLUMN IF NOT EXISTS external_imdb_id TEXT`,
    `ADD COLUMN IF NOT EXISTS external_tvdb_id TEXT`,
    `ADD COLUMN IF NOT EXISTS external_tvmaze_id INTEGER`,
    `ADD COLUMN IF NOT EXISTS external_anilist_id INTEGER`,
    `ADD COLUMN IF NOT EXISTS metadata_locked BOOLEAN NOT NULL DEFAULT false`,
    `ADD COLUMN IF NOT EXISTS metadata_attempts JSONB NOT NULL DEFAULT '[]'::jsonb`
  ];
  for (const clause of metadataColumns) await pool.query(`ALTER TABLE media ${clause}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_streams (
      id BIGSERIAL PRIMARY KEY,
      media_id BIGINT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      stream_index INTEGER NOT NULL,
      codec_type TEXT NOT NULL,
      codec_name TEXT,
      profile TEXT,
      pixel_format TEXT,
      width INTEGER,
      height INTEGER,
      channels INTEGER,
      channel_layout TEXT,
      language TEXT,
      title TEXT,
      is_default BOOLEAN NOT NULL DEFAULT false,
      is_forced BOOLEAN NOT NULL DEFAULT false,
      UNIQUE(media_id, stream_index)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS playback_progress (
      profile_id TEXT NOT NULL,
      media_id BIGINT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      position_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
      duration_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
      completed BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(profile_id, media_id)
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_media_status ON media(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_media_relative_path ON media(relative_path)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_media_kind ON media(media_kind)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_media_tmdb ON media(tmdb_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_media_metadata_status ON media(metadata_status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_media_metadata_provider ON media(metadata_provider)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_media_metadata_locked ON media(metadata_locked)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_streams_media_id ON media_streams(media_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_progress_updated ON playback_progress(profile_id, updated_at DESC)`);
}

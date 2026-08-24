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

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_media_status ON media(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_media_relative_path ON media(relative_path)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_streams_media_id ON media_streams(media_id)`);
}

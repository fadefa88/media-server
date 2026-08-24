import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const VIDEO_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.m4v', '.mov', '.avi', '.ts', '.m2ts', '.mts',
  '.webm', '.wmv', '.mpg', '.mpeg'
]);

function normalized(p) {
  return path.resolve(p);
}

function excluded(filePath, excludeRoot) {
  if (!excludeRoot) return false;
  const file = normalized(filePath);
  const ex = normalized(excludeRoot);
  return file === ex || file.startsWith(`${ex}${path.sep}`);
}

export async function* walkMedia(root, excludeRoot) {
  const stack = [normalized(root)];

  while (stack.length) {
    const dir = stack.pop();
    if (excluded(dir, excludeRoot)) continue;

    let handle;
    try {
      handle = await fs.opendir(dir);
    } catch {
      continue;
    }

    for await (const entry of handle) {
      const full = path.join(dir, entry.name);
      if (excluded(full, excludeRoot)) continue;
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) yield full;
    }
  }
}

export async function countMedia(root, excludeRoot, limit = 0) {
  let count = 0;
  for await (const _ of walkMedia(root, excludeRoot)) {
    count++;
    if (limit > 0 && count >= limit) break;
  }
  return count;
}

function bitDepthFromPixelFormat(fmt = '') {
  const value = String(fmt).toLowerCase();
  if (/p16|16le|16be/.test(value)) return 16;
  if (/p12|12le|12be/.test(value)) return 12;
  if (/p10|10le|10be/.test(value)) return 10;
  return value ? 8 : null;
}

function hdrFromVideo(video = {}) {
  const sideData = JSON.stringify(video.side_data_list || []);
  if (/dovi|dolby.?vision/i.test(sideData)) return 'Dolby Vision';
  if (video.color_transfer === 'smpte2084') return 'HDR10/PQ';
  if (video.color_transfer === 'arib-std-b67') return 'HLG';
  return 'SDR';
}

export async function probeMedia(filePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath
  ], {
    timeout: 45_000,
    maxBuffer: 16 * 1024 * 1024
  });

  const probe = JSON.parse(stdout);
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find(s => s.codec_type === 'video');
  if (!video) throw new Error('nessuna traccia video trovata');

  return {
    probe,
    video,
    streams,
    hdr: hdrFromVideo(video),
    bitDepth: bitDepthFromPixelFormat(video.pix_fmt)
  };
}

async function saveValid(pool, root, filePath, stat, info) {
  const { probe, video, streams, hdr, bitDepth } = info;
  const format = probe.format || {};
  const relativePath = path.relative(root, filePath);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(`
      INSERT INTO media (
        path, relative_path, filename, extension, size_bytes,
        container, duration_seconds, bitrate_bps,
        width, height, video_codec, video_profile,
        pixel_format, bit_depth, hdr, color_transfer,
        status, probe_error, updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,
        $9,$10,$11,$12,
        $13,$14,$15,$16,
        'OK',NULL,now()
      )
      ON CONFLICT(path) DO UPDATE SET
        relative_path=EXCLUDED.relative_path,
        filename=EXCLUDED.filename,
        extension=EXCLUDED.extension,
        size_bytes=EXCLUDED.size_bytes,
        container=EXCLUDED.container,
        duration_seconds=EXCLUDED.duration_seconds,
        bitrate_bps=EXCLUDED.bitrate_bps,
        width=EXCLUDED.width,
        height=EXCLUDED.height,
        video_codec=EXCLUDED.video_codec,
        video_profile=EXCLUDED.video_profile,
        pixel_format=EXCLUDED.pixel_format,
        bit_depth=EXCLUDED.bit_depth,
        hdr=EXCLUDED.hdr,
        color_transfer=EXCLUDED.color_transfer,
        status='OK',
        probe_error=NULL,
        updated_at=now()
      RETURNING id
    `, [
      filePath,
      relativePath,
      path.basename(filePath),
      path.extname(filePath).toLowerCase(),
      stat.size,
      format.format_name || null,
      format.duration ? Number(format.duration) : null,
      format.bit_rate ? Number(format.bit_rate) : null,
      Number(video.width) || null,
      Number(video.height) || null,
      video.codec_name || null,
      video.profile || null,
      video.pix_fmt || null,
      bitDepth,
      hdr,
      video.color_transfer || null
    ]);

    const mediaId = result.rows[0].id;
    await client.query('DELETE FROM media_streams WHERE media_id=$1', [mediaId]);

    for (const stream of streams) {
      if (!['video', 'audio', 'subtitle'].includes(stream.codec_type)) continue;
      const tags = stream.tags || {};
      const disposition = stream.disposition || {};
      await client.query(`
        INSERT INTO media_streams (
          media_id, stream_index, codec_type, codec_name, profile,
          pixel_format, width, height, channels, channel_layout,
          language, title, is_default, is_forced
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      `, [
        mediaId,
        Number(stream.index),
        stream.codec_type,
        stream.codec_name || null,
        stream.profile || null,
        stream.pix_fmt || null,
        Number(stream.width) || null,
        Number(stream.height) || null,
        Number(stream.channels) || null,
        stream.channel_layout || null,
        tags.language || null,
        tags.title || null,
        Boolean(disposition.default),
        Boolean(disposition.forced)
      ]);
    }

    await client.query('COMMIT');
    return mediaId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function saveInvalid(pool, root, filePath, stat, error) {
  const relativePath = path.relative(root, filePath);
  await pool.query(`
    INSERT INTO media (
      path, relative_path, filename, extension, size_bytes,
      status, probe_error, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,'INVALID',$6,now())
    ON CONFLICT(path) DO UPDATE SET
      relative_path=EXCLUDED.relative_path,
      filename=EXCLUDED.filename,
      extension=EXCLUDED.extension,
      size_bytes=EXCLUDED.size_bytes,
      status='INVALID',
      probe_error=EXCLUDED.probe_error,
      updated_at=now()
  `, [
    filePath,
    relativePath,
    path.basename(filePath),
    path.extname(filePath).toLowerCase(),
    stat?.size || null,
    String(error?.message || error).slice(0, 4000)
  ]);
}

export function createScanState() {
  return {
    running: false,
    total: 0,
    processed: 0,
    valid: 0,
    invalid: 0,
    current: null,
    startedAt: null,
    finishedAt: null,
    lastError: null
  };
}

export async function scanLibrary({
  pool,
  root = process.env.MEDIA_ROOT || '/media',
  excludeRoot = process.env.MEDIA_EXCLUDE || '/media/Foto',
  limit = 0,
  state = createScanState()
}) {
  if (state.running) throw new Error('scan gia in esecuzione');

  const mediaRoot = normalized(root);
  const exclude = excludeRoot ? normalized(excludeRoot) : null;

  state.running = true;
  state.total = 0;
  state.processed = 0;
  state.valid = 0;
  state.invalid = 0;
  state.current = null;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.lastError = null;

  try {
    state.total = await countMedia(mediaRoot, exclude, limit);

    let seen = 0;
    for await (const filePath of walkMedia(mediaRoot, exclude)) {
      if (limit > 0 && seen >= limit) break;
      seen++;
      state.current = path.relative(mediaRoot, filePath);

      let stat = null;
      try {
        stat = await fs.stat(filePath);
        const info = await probeMedia(filePath);
        await saveValid(pool, mediaRoot, filePath, stat, info);
        state.valid++;
      } catch (error) {
        await saveInvalid(pool, mediaRoot, filePath, stat, error);
        state.invalid++;
        state.lastError = String(error?.message || error);
      } finally {
        state.processed++;
      }
    }

    return { ...state };
  } finally {
    state.running = false;
    state.current = null;
    state.finishedAt = new Date().toISOString();
  }
}

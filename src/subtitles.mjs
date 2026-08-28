import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const TEXT_SUBTITLE_CODECS = new Set(['subrip','srt','ass','ssa','webvtt','vtt','mov_text']);
const SUBTITLE_CACHE_ROOT = path.resolve(process.env.SUBTITLE_CACHE_ROOT || '/opt/vela/cache/subtitles');
const cacheBuilds = new Map();

export function isTextSubtitleCodec(codec) {
  return TEXT_SUBTITLE_CODECS.has(String(codec || '').toLowerCase());
}

function cachePathFor(record, streamIndex) {
  return path.join(SUBTITLE_CACHE_ROOT, `${Number(record.media.id)}-${Number(streamIndex)}.vtt`);
}

async function cacheIsFresh(cachePath, sourcePath) {
  try {
    const [cacheStat, sourceStat] = await Promise.all([fs.stat(cachePath), fs.stat(sourcePath)]);
    return cacheStat.isFile() && cacheStat.size > 0 && cacheStat.mtimeMs >= sourceStat.mtimeMs;
  } catch {
    return false;
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore','ignore','pipe'] });
    let stderr = '';
    ffmpeg.stderr.setEncoding('utf8');
    ffmpeg.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-8000); });
    ffmpeg.on('error', reject);
    ffmpeg.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg subtitle exit ${code}`));
    });
  });
}

async function ensureSubtitleCache(record, streamIndex) {
  const cachePath = cachePathFor(record, streamIndex);
  if (await cacheIsFresh(cachePath, record.media.path)) return { cachePath, hit: true };

  if (cacheBuilds.has(cachePath)) {
    await cacheBuilds.get(cachePath);
    return { cachePath, hit: true };
  }

  const build = (async () => {
    await fs.mkdir(SUBTITLE_CACHE_ROOT, { recursive: true });
    if (await cacheIsFresh(cachePath, record.media.path)) return;

    const tmpPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await runFfmpeg([
        '-hide_banner','-loglevel','error','-nostdin','-y',
        '-i', record.media.path,
        '-map', `0:${Number(streamIndex)}`,
        '-c:s', 'webvtt',
        '-f', 'webvtt',
        tmpPath
      ]);
      const stat = await fs.stat(tmpPath);
      if (!stat.isFile() || stat.size === 0) throw new Error('cache sottotitoli vuota');
      await fs.rename(tmpPath, cachePath);
    } finally {
      await fs.rm(tmpPath, { force: true }).catch(() => {});
    }
  })();

  cacheBuilds.set(cachePath, build);
  try {
    await build;
  } finally {
    cacheBuilds.delete(cachePath);
  }
  return { cachePath, hit: false };
}

function parseVttTime(value) {
  const match = /^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(String(value).trim());
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4]);
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

function formatVttTime(seconds) {
  const ms = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')}.${String(millis).padStart(3,'0')}`;
}

export function shiftWebVtt(vtt, offsetSeconds = 0) {
  const offset = Math.max(0, Number(offsetSeconds || 0));
  if (!offset) return String(vtt || '');

  const normalized = String(vtt || '').replace(/\r\n/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  const output = [];

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    const timingIndex = lines.findIndex(line => /-->/.test(line));
    if (timingIndex === -1) {
      output.push(block);
      continue;
    }

    const match = /^(\s*)(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})(.*)$/.exec(lines[timingIndex]);
    if (!match) {
      output.push(block);
      continue;
    }

    const start = parseVttTime(match[2]);
    const end = parseVttTime(match[3]);
    if (start === null || end === null || end <= offset) continue;

    lines[timingIndex] = `${match[1]}${formatVttTime(Math.max(0, start - offset))} --> ${formatVttTime(end - offset)}${match[4]}`;
    output.push(lines.join('\n'));
  }

  return `${output.join('\n\n')}\n`;
}

async function serveSubtitle({ record, streamIndex, offsetSeconds = 0, res }) {
  const track = record.streams.find(s => s.codec_type === 'subtitle' && Number(s.stream_index) === Number(streamIndex));
  if (!track) throw new Error('traccia sottotitoli non trovata');
  if (!isTextSubtitleCodec(track.codec_name)) throw new Error('questa traccia richiede burn-in e non e disponibile in WebVTT');

  const { cachePath, hit } = await ensureSubtitleCache(record, streamIndex);
  const cachedVtt = await fs.readFile(cachePath, 'utf8');
  const body = shiftWebVtt(cachedVtt, offsetSeconds);

  res.writeHead(200, {
    'content-type': 'text/vtt; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'private, max-age=3600',
    'x-vela-subtitle-cache': hit ? 'HIT' : 'MISS'
  });
  res.end(body);
}

export function streamSubtitleAsWebVtt(options) {
  void serveSubtitle(options).catch(error => {
    if (!options.res.headersSent) {
      const body = String(error?.message || error);
      options.res.writeHead(500, {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store'
      });
      options.res.end(body);
      return;
    }
    if (!options.res.destroyed) options.res.destroy(error);
  });
}

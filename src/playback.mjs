import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { optimizeTracks } from './track-optimizer.mjs';
import { decidePlayback } from '../engine/client-first.mjs';
import { isTextSubtitleCodec } from './subtitles.mjs';

const TRANSCODE_ROOT = path.resolve(process.env.TRANSCODE_ROOT || '/opt/vela/transcode');
const VIDEO_TRANSCODE_ENABLED = String(process.env.VIDEO_TRANSCODE_ENABLED || 'false').toLowerCase() === 'true';
const SESSION_TTL_MS = Math.max(5 * 60_000, Number(process.env.PLAYBACK_SESSION_TTL_MS || 30 * 60_000));
const READY_TIMEOUT_MS = Math.max(2_000, Number(process.env.PLAYBACK_READY_TIMEOUT_MS || 15_000));

const sessions = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const norm = value => String(value || '').trim().toLowerCase();

function mediaContainer(media) {
  if (String(media.container || '').includes('matroska')) return 'mkv';
  return path.extname(media.filename || '').replace('.', '').toLowerCase();
}

function compatibilityForAudio(track, client) {
  const codecs = new Set((client.audioCodecs || ['aac','ac3','eac3','mp3','alac']).map(norm));
  const compatible = codecs.has(norm(track.codec_name));
  return { ...track, compatible, action: compatible ? 'COPY' : 'TRANSCODE_AAC' };
}

function selectTracks(record, client, options = {}) {
  const selected = optimizeTracks(record.streams, client);

  if (options.audioStreamIndex !== undefined && options.audioStreamIndex !== null && options.audioStreamIndex !== '') {
    const requested = record.streams.find(s => s.codec_type === 'audio' && Number(s.stream_index) === Number(options.audioStreamIndex));
    if (requested) selected.audio = compatibilityForAudio(requested, client);
  }

  if (options.subtitleStreamIndex !== undefined && options.subtitleStreamIndex !== null && options.subtitleStreamIndex !== '') {
    const requested = record.streams.find(s => s.codec_type === 'subtitle' && Number(s.stream_index) === Number(options.subtitleStreamIndex));
    if (requested) {
      const textual = isTextSubtitleCodec(requested.codec_name);
      selected.subtitle = {
        ...requested,
        textual,
        action: textual ? 'WEBVTT' : 'BURN_IF_ENABLED'
      };
    }
  }

  return selected;
}

function flattenForDecision(record, selected) {
  const media = record.media;
  return {
    videoCodec: selected.video?.codec_name || media.video_codec,
    audioCodec: selected.audio?.codec_name || 'aac',
    container: mediaContainer(media),
    hdr: media.hdr || 'SDR',
    bitrate: media.bitrate_bps ? Number(media.bitrate_bps) / 1_000_000 : 0,
    width: media.width,
    height: media.height,
    subtitleFormat: selected.subtitle?.codec_name || ''
  };
}

export function planPlayback(record, client = {}, options = {}) {
  const selected = selectTracks(record, client, options);
  const flattened = flattenForDecision(record, selected);
  const decision = decidePlayback(flattened, client, {
    forceOriginal: Boolean(options.forceOriginal),
    subtitlesEnabled: Boolean(options.subtitlesEnabled),
    subtitleFormat: selected.subtitle?.codec_name || ''
  });

  const manualAudioRequested = options.audioStreamIndex !== undefined && options.audioStreamIndex !== null && options.audioStreamIndex !== '';
  if (manualAudioRequested && decision.mode === 'DIRECT') {
    decision.mode = 'REMUX';
    decision.containerAction = 'REMUX_FMP4_HLS';
    decision.target = 'Qualità originale · traccia audio selezionata';
    decision.reason = 'VELA esegue un remux per garantire la traccia audio scelta senza ricodificare il video.';
  }

  if (decision.mode === 'VIDEO_TRANSCODE' && !VIDEO_TRANSCODE_ENABLED) {
    decision.blocked = true;
    decision.blockReason = decision.reason
      ? `${decision.reason} Video transcoding disabilitato in questa fase VELA.`
      : 'Video transcoding disabilitato in questa fase VELA.';
  }

  return { selected, decision, flattened };
}

export function buildHlsArgs(record, plan, outputDir, startSeconds = 0) {
  const { selected, decision } = plan;
  const start = Math.max(0, Number(startSeconds || 0));
  const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-y'];

  // Input-side seek is fast even on large files. A new rolling HLS session is
  // created after every long seek, so temporary disk usage stays bounded.
  if (start > 0) args.push('-ss', start.toFixed(3));
  // Fill the initial HLS buffer as fast as storage allows, then resume
  // realtime pacing so the rolling playlist remains bounded during playback.
  args.push('-readrate', '1', '-readrate_initial_burst', '12', '-i', record.media.path);

  if (!selected.video) throw new Error('nessuna traccia video disponibile');
  args.push('-map', `0:${selected.video.stream_index}`);

  if (selected.audio) args.push('-map', `0:${selected.audio.stream_index}`);
  else args.push('-an');

  args.push('-sn', '-dn', '-c:v', 'copy');
  if (norm(selected.video.codec_name) === 'hevc') args.push('-tag:v', 'hvc1');

  if (selected.audio) {
    if (decision.mode === 'AUDIO_TRANSCODE' || selected.audio.action === 'TRANSCODE_AAC') {
      args.push('-c:a', 'aac', '-b:a', '256k', '-ac', String(Math.min(Number(selected.audio.channels || 2), 6)));
    } else {
      args.push('-c:a', 'copy');
    }
  }

  args.push(
    '-avoid_negative_ts', 'make_zero',
    '-f', 'hls',
    '-hls_segment_type', 'fmp4',
    '-hls_time', '6',
    '-hls_list_size', '12',
    '-hls_delete_threshold', '2',
    '-hls_flags', 'independent_segments+delete_segments+temp_file',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', path.join(outputDir, 'seg-%06d.m4s'),
    path.join(outputDir, 'index.m3u8')
  );

  return args;
}

async function waitForFile(filePath, processRef, timeoutMs = READY_TIMEOUT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile() && stat.size > 0) return;
    } catch {}
    if (processRef.exitCode !== null) throw new Error(`ffmpeg terminato prima che il playback fosse pronto (exit ${processRef.exitCode})`);
    await sleep(100);
  }
  throw new Error('timeout durante la preparazione HLS');
}

async function cleanupSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  if (session.process && session.process.exitCode === null) {
    session.process.kill('SIGTERM');
    setTimeout(() => {
      if (session.process.exitCode === null) session.process.kill('SIGKILL');
    }, 2_000).unref?.();
  }
  await fs.rm(session.dir, { recursive: true, force: true }).catch(() => {});
}

async function startHlsSession(record, plan, startSeconds = 0) {
  await fs.mkdir(TRANSCODE_ROOT, { recursive: true });
  const id = crypto.randomUUID();
  const dir = path.join(TRANSCODE_ROOT, id);
  await fs.mkdir(dir, { recursive: true });

  const start = Math.max(0, Math.min(Number(startSeconds || 0), Math.max(0, Number(record.media.duration_seconds || 0) - 1)));
  const args = buildHlsArgs(record, plan, dir, start);
  const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const session = {
    id,
    mediaId: Number(record.media.id),
    mode: plan.decision.mode,
    startSeconds: start,
    durationSeconds: Number(record.media.duration_seconds || 0),
    dir,
    process: ffmpeg,
    createdAt: Date.now(),
    lastAccess: Date.now(),
    state: 'STARTING',
    stderr: '',
    selectedTracks: plan.selected,
    decision: plan.decision
  };
  sessions.set(id, session);

  ffmpeg.stderr.setEncoding('utf8');
  ffmpeg.stderr.on('data', chunk => { session.stderr = `${session.stderr}${chunk}`.slice(-12_000); });
  ffmpeg.on('error', error => {
    session.state = 'ERROR';
    session.stderr = `${session.stderr}\n${error.message}`.trim();
  });
  ffmpeg.on('exit', code => {
    session.state = code === 0 ? 'READY' : 'ERROR';
    session.exitCode = code;
  });

  try {
    await waitForFile(path.join(dir, 'index.m3u8'), ffmpeg);
    await waitForFile(path.join(dir, 'init.mp4'), ffmpeg);
    session.state = 'READY';
  } catch (error) {
    session.state = 'ERROR';
    session.stderr = `${session.stderr}\n${error.message}`.trim();
    await cleanupSession(id);
    throw new Error(`${error.message}${session.stderr ? `: ${session.stderr.slice(-1000)}` : ''}`);
  }

  return session;
}

export async function createPlayback(record, client = {}, options = {}) {
  const plan = planPlayback(record, client, options);
  const requestedStart = Math.max(0, Number(options.startSeconds || 0));

  if (plan.decision.blocked) {
    return {
      type: 'BLOCKED',
      error: plan.decision.blockReason || plan.decision.reason || 'Playback bloccato',
      selectedTracks: plan.selected,
      decision: plan.decision
    };
  }

  if (plan.decision.mode === 'DIRECT') {
    return {
      type: 'DIRECT',
      url: `/stream/${record.media.id}`,
      startSeconds: requestedStart,
      durationSeconds: Number(record.media.duration_seconds || 0),
      selectedTracks: plan.selected,
      decision: plan.decision
    };
  }

  if (!['REMUX', 'AUDIO_TRANSCODE'].includes(plan.decision.mode)) {
    throw new Error(`modalita playback non supportata in v0.4: ${plan.decision.mode}`);
  }

  const session = await startHlsSession(record, plan, requestedStart);
  return {
    type: 'HLS',
    sessionId: session.id,
    url: `/playback/${session.id}/index.m3u8`,
    startSeconds: session.startSeconds,
    durationSeconds: session.durationSeconds,
    selectedTracks: plan.selected,
    decision: plan.decision
  };
}

export function getPlaybackSession(id) {
  const session = sessions.get(id);
  if (session) session.lastAccess = Date.now();
  return session || null;
}

export async function stopPlayback(id) {
  const existed = sessions.has(id);
  await cleanupSession(id);
  return existed;
}

export async function resolvePlaybackAsset(id, asset) {
  const session = getPlaybackSession(id);
  if (!session) return null;
  if (!/^(index\.m3u8|init\.mp4|seg-\d{6}\.m4s)$/.test(asset)) return null;
  const filePath = path.join(session.dir, asset);
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    return { session, filePath, stat };
  } catch {
    return null;
  }
}

export function playbackMime(asset) {
  if (asset.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (asset.endsWith('.m4s')) return 'video/iso.segment';
  if (asset.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastAccess > SESSION_TTL_MS) cleanupSession(id).catch(() => {});
  }
}, 60_000);
cleanupTimer.unref?.();

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { optimizeTracks } from './track-optimizer.mjs';
import { decidePlayback } from '../engine/client-first.mjs';
import { isTextSubtitleCodec } from './subtitles.mjs';
import { createPlaybackSessionId, signDirectStreamUrl } from './stream-signing.mjs';

const TRANSCODE_ROOT = path.resolve(process.env.TRANSCODE_ROOT || '/opt/vela/transcode');
const VIDEO_TRANSCODE_ENABLED = String(process.env.VIDEO_TRANSCODE_ENABLED || 'true').toLowerCase() !== 'false';
const VIDEO_TRANSCODE_HW_ACCEL = String(process.env.VIDEO_TRANSCODE_HW_ACCEL || 'true').toLowerCase() !== 'false';
const VIDEO_TRANSCODE_SOFTWARE_FALLBACK = String(process.env.VIDEO_TRANSCODE_SOFTWARE_FALLBACK || 'true').toLowerCase() !== 'false';
const VIDEO_TRANSCODE_VAAPI_DEVICE = path.resolve(process.env.VIDEO_TRANSCODE_VAAPI_DEVICE || '/dev/dri/renderD128');
const VIDEO_TRANSCODE_MAX_WIDTH = Math.max(640, Math.min(3840, Number(process.env.VIDEO_TRANSCODE_MAX_WIDTH || 1920)));
const SUBTITLE_BURNIN_ENABLED = String(process.env.SUBTITLE_BURNIN_ENABLED || 'true').toLowerCase() !== 'false';
const SUBTITLE_BURNIN_HW_ACCEL = String(process.env.SUBTITLE_BURNIN_HW_ACCEL || 'true').toLowerCase() !== 'false';
const SUBTITLE_BURNIN_SOFTWARE_FALLBACK = String(process.env.SUBTITLE_BURNIN_SOFTWARE_FALLBACK || 'true').toLowerCase() !== 'false';
const SUBTITLE_BURNIN_VAAPI_DEVICE = path.resolve(process.env.SUBTITLE_BURNIN_VAAPI_DEVICE || VIDEO_TRANSCODE_VAAPI_DEVICE);
const SUBTITLE_BURNIN_MAX_WIDTH = Math.max(640, Math.min(3840, Number(process.env.SUBTITLE_BURNIN_MAX_WIDTH || 1920)));
const SUBTITLE_BURNIN_VIDEO_MBIT = Math.max(3, Math.min(30, Number(process.env.SUBTITLE_BURNIN_VIDEO_MBIT || 10)));
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

function targetVideoMbit(decision) {
  const match = /(\d+(?:\.\d+)?)\s*Mbps/i.exec(String(decision?.target || ''));
  const requested = match ? Number(match[1]) : 12;
  return Math.max(3, Math.min(30, requested));
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

  const subtitleBurnIn = Boolean(
    options.subtitlesEnabled &&
    selected.subtitle &&
    selected.subtitle.textual === false &&
    decision.mode === 'VIDEO_TRANSCODE'
  );
  const videoTranscode = decision.mode === 'VIDEO_TRANSCODE';

  if (subtitleBurnIn) {
    decision.subtitleBurnIn = true;
    decision.videoAction = 'BURN_SUBTITLE';
    decision.containerAction = 'HLS';
    decision.cpuImpact = 'GPU preferred';
    decision.target = `H.264 · max ${SUBTITLE_BURNIN_MAX_WIDTH}px · ${SUBTITLE_BURNIN_VIDEO_MBIT} Mbps`;
    decision.reason = 'Sottotitolo bitmap: VELA lo compone nel video, preferendo Intel VAAPI.';
  } else if (videoTranscode) {
    decision.videoAction = 'TRANSCODE_H264';
    decision.containerAction = 'HLS';
    decision.cpuImpact = 'GPU preferred';
    decision.target = `H.264 · max ${VIDEO_TRANSCODE_MAX_WIDTH}px · ${targetVideoMbit(decision)} Mbps`;
  }

  if (videoTranscode && !VIDEO_TRANSCODE_ENABLED && !(subtitleBurnIn && SUBTITLE_BURNIN_ENABLED)) {
    decision.blocked = true;
    decision.blockReason = decision.reason
      ? `${decision.reason} Video transcoding disabilitato.`
      : 'Video transcoding disabilitato.';
  }

  return { selected, decision, flattened, subtitleBurnIn, videoTranscode };
}

function scaleFilter(maxWidth, encoder) {
  const scale = `scale=w='min(${maxWidth},iw)':h=-2:flags=fast_bilinear`;
  return encoder === 'vaapi' ? `${scale},format=nv12,hwupload` : `${scale},format=yuv420p`;
}

function burnInFilter(plan, encoder) {
  const videoIndex = Number(plan.selected.video.stream_index);
  const subtitleIndex = Number(plan.selected.subtitle.stream_index);
  return `[0:${videoIndex}][0:${subtitleIndex}]overlay=eof_action=pass:shortest=0,${scaleFilter(SUBTITLE_BURNIN_MAX_WIDTH, encoder)}[vout]`;
}

function addVideoEncoderArgs(args, encoder, videoMbit) {
  const videoBitrate = `${videoMbit}M`;
  const maxrate = `${Math.ceil(videoMbit * 1.2)}M`;
  const bufsize = `${Math.ceil(videoMbit * 2)}M`;
  if (encoder === 'vaapi') {
    args.push('-c:v', 'h264_vaapi', '-profile:v', 'high', '-b:v', videoBitrate, '-maxrate', maxrate, '-bufsize', bufsize);
  } else {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-b:v', videoBitrate, '-maxrate', maxrate, '-bufsize', bufsize);
  }
  args.push('-force_key_frames', 'expr:gte(t,n_forced*4)');
}

export function buildHlsArgs(record, plan, outputDir, startSeconds = 0, runtime = {}) {
  const { selected, decision } = plan;
  const start = Math.max(0, Number(startSeconds || 0));
  const videoEncoder = runtime.videoEncoder || runtime.burnInEncoder || null;
  const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-y'];

  if (plan.videoTranscode && videoEncoder === 'vaapi') {
    args.push('-vaapi_device', runtime.vaapiDevice || (plan.subtitleBurnIn ? SUBTITLE_BURNIN_VAAPI_DEVICE : VIDEO_TRANSCODE_VAAPI_DEVICE));
  }

  if (start > 0) args.push('-ss', start.toFixed(3));
  args.push('-readrate', '1', '-readrate_initial_burst', '12', '-i', record.media.path);

  if (!selected.video) throw new Error('nessuna traccia video disponibile');

  if (plan.subtitleBurnIn) {
    if (!selected.subtitle) throw new Error('nessuna traccia sottotitoli disponibile per burn-in');
    if (!videoEncoder) throw new Error('encoder video non specificato');
    args.push('-filter_complex', burnInFilter(plan, videoEncoder), '-map', '[vout]');
  } else {
    args.push('-map', `0:${selected.video.stream_index}`);
    if (plan.videoTranscode) {
      if (!videoEncoder) throw new Error('encoder video non specificato');
      args.push('-vf', scaleFilter(VIDEO_TRANSCODE_MAX_WIDTH, videoEncoder));
    }
  }

  if (selected.audio) args.push('-map', `0:${selected.audio.stream_index}`);
  else args.push('-an');

  args.push('-sn', '-dn');

  if (plan.videoTranscode) {
    addVideoEncoderArgs(args, videoEncoder, plan.subtitleBurnIn ? SUBTITLE_BURNIN_VIDEO_MBIT : targetVideoMbit(decision));
  } else {
    args.push('-c:v', 'copy');
    if (norm(selected.video.codec_name) === 'hevc') args.push('-tag:v', 'hvc1');
  }

  if (selected.audio) {
    if (decision.mode === 'AUDIO_TRANSCODE' || selected.audio.action === 'TRANSCODE_AAC' || decision.audioAction === 'TRANSCODE_AAC') {
      args.push('-c:a', 'aac', '-b:a', '256k', '-ac', String(Math.min(Number(selected.audio.channels || 2), 6)));
    } else {
      args.push('-c:a', 'copy');
    }
  }

  args.push(
    '-avoid_negative_ts', 'make_zero',
    '-f', 'hls',
    '-hls_segment_type', 'fmp4',
    '-hls_time', plan.videoTranscode ? '4' : '6',
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

async function startHlsAttempt(record, plan, startSeconds = 0, runtime = {}) {
  await fs.mkdir(TRANSCODE_ROOT, { recursive: true });
  const capability = createPlaybackSessionId();
  const id = capability.id;
  const dir = path.join(TRANSCODE_ROOT, id);
  await fs.mkdir(dir, { recursive: true });

  const start = Math.max(0, Math.min(Number(startSeconds || 0), Math.max(0, Number(record.media.duration_seconds || 0) - 1)));
  const args = buildHlsArgs(record, plan, dir, start, runtime);
  const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const selectedEncoder = runtime.videoEncoder || runtime.burnInEncoder || null;
  const decision = {
    ...plan.decision,
    ...(plan.videoTranscode ? { videoTranscodeEncoder: selectedEncoder || 'software' } : {}),
    ...(plan.subtitleBurnIn ? { burnInEncoder: selectedEncoder || 'software' } : {})
  };
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
    decision,
    urlExpiresAt: capability.expiresAt ? new Date(capability.expiresAt * 1000).toISOString() : null
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
    const detail = session.stderr.slice(-1600);
    await cleanupSession(id);
    throw new Error(`${error.message}${detail ? `: ${detail}` : ''}`);
  }

  return session;
}

async function canUseVaapi(plan) {
  const enabled = plan.subtitleBurnIn ? SUBTITLE_BURNIN_HW_ACCEL : VIDEO_TRANSCODE_HW_ACCEL;
  const device = plan.subtitleBurnIn ? SUBTITLE_BURNIN_VAAPI_DEVICE : VIDEO_TRANSCODE_VAAPI_DEVICE;
  if (!enabled) return false;
  try {
    await fs.access(device);
    return true;
  } catch {
    return false;
  }
}

async function startVideoTranscodeSession(record, plan, startSeconds = 0) {
  const failures = [];
  const vaapiDevice = plan.subtitleBurnIn ? SUBTITLE_BURNIN_VAAPI_DEVICE : VIDEO_TRANSCODE_VAAPI_DEVICE;
  const softwareFallback = plan.subtitleBurnIn ? SUBTITLE_BURNIN_SOFTWARE_FALLBACK : VIDEO_TRANSCODE_SOFTWARE_FALLBACK;

  if (await canUseVaapi(plan)) {
    try {
      return await startHlsAttempt(record, plan, startSeconds, {
        videoEncoder: 'vaapi',
        vaapiDevice
      });
    } catch (error) {
      failures.push(`VAAPI: ${error.message}`);
    }
  }

  if (softwareFallback) {
    try {
      return await startHlsAttempt(record, plan, startSeconds, { videoEncoder: 'software' });
    } catch (error) {
      failures.push(`software: ${error.message}`);
    }
  }

  const label = plan.subtitleBurnIn ? 'burn-in sottotitoli' : 'video transcoding';
  throw new Error(`${label} non disponibile${failures.length ? `: ${failures.join(' | ')}` : ''}`);
}

async function startHlsSession(record, plan, startSeconds = 0) {
  if (plan.videoTranscode) return startVideoTranscodeSession(record, plan, startSeconds);
  return startHlsAttempt(record, plan, startSeconds);
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
    const signed = signDirectStreamUrl(record.media.id);
    return {
      type: 'DIRECT',
      url: signed.url,
      urlExpiresAt: signed.expiresAt ? new Date(signed.expiresAt * 1000).toISOString() : null,
      startSeconds: requestedStart,
      durationSeconds: Number(record.media.duration_seconds || 0),
      selectedTracks: plan.selected,
      decision: plan.decision
    };
  }

  const supportedHlsMode = ['REMUX', 'AUDIO_TRANSCODE', 'VIDEO_TRANSCODE'].includes(plan.decision.mode);
  if (!supportedHlsMode) {
    throw new Error(`modalita playback non supportata: ${plan.decision.mode}`);
  }

  const session = await startHlsSession(record, plan, requestedStart);
  return {
    type: 'HLS',
    sessionId: session.id,
    url: `/playback/${session.id}/index.m3u8`,
    urlExpiresAt: session.urlExpiresAt,
    startSeconds: session.startSeconds,
    durationSeconds: session.durationSeconds,
    selectedTracks: session.selectedTracks,
    decision: session.decision
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHlsArgs, planPlayback } from '../src/playback.mjs';

const record = {
  media: {
    id: 1,
    path: '/media/test.mkv',
    filename: 'test.mkv',
    container: 'matroska,webm',
    video_codec: 'hevc',
    width: 1920,
    height: 800,
    hdr: 'SDR',
    bitrate_bps: 2400000,
    duration_seconds: 7200
  },
  streams: [
    { stream_index: 0, codec_type: 'video', codec_name: 'hevc' },
    { stream_index: 1, codec_type: 'audio', codec_name: 'aac', channels: 6, is_default: true },
    { stream_index: 2, codec_type: 'audio', codec_name: 'dts', channels: 6, language: 'eng' },
    { stream_index: 3, codec_type: 'subtitle', codec_name: 'subrip', language: 'ita' },
    { stream_index: 4, codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle', language: 'ita' }
  ]
};

const client = {
  videoCodecs: ['h264', 'hevc'],
  audioCodecs: ['aac', 'ac3', 'eac3'],
  containers: ['mp4', 'mov', 'hls', 'fmp4'],
  subtitleFormats: ['vtt', 'webvtt'],
  maxWidth: 4096,
  maxHeight: 2160,
  networkMbps: 100
};

test('MKV HEVC AAC is remuxed with copied video/audio', () => {
  const plan = planPlayback(record, client, { forceOriginal: true });
  assert.equal(plan.decision.mode, 'REMUX');
  const args = buildHlsArgs(record, plan, '/tmp/test');
  assert.equal(args[args.indexOf('-c:v') + 1], 'copy');
  assert.ok(args.includes('hvc1'));
  assert.equal(args[args.indexOf('-c:a') + 1], 'copy');
  assert.ok(args.includes('fmp4'));
});

test('HLS starts with a 12 second burst before realtime pacing', () => {
  const plan = planPlayback(record, client, { forceOriginal: true });
  const args = buildHlsArgs(record, plan, '/tmp/test');
  assert.equal(args[args.indexOf('-readrate') + 1], '1');
  assert.equal(args[args.indexOf('-readrate_initial_burst') + 1], '12');
  assert.equal(args.includes('-re'), false);
  assert.ok(args.indexOf('-readrate_initial_burst') < args.indexOf('-i'));
});

test('DTS audio keeps video copy and transcodes only audio', () => {
  const plan = planPlayback(record, client, { forceOriginal: true, audioStreamIndex: 2 });
  assert.equal(plan.decision.mode, 'AUDIO_TRANSCODE');
  const args = buildHlsArgs(record, plan, '/tmp/test');
  assert.equal(args[args.indexOf('-c:v') + 1], 'copy');
  assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
  assert.ok(args.includes('0:2'));
});

test('HLS seek uses input offset and still copies video', () => {
  const plan = planPlayback(record, client, { forceOriginal: true });
  const args = buildHlsArgs(record, plan, '/tmp/test', 3600);
  assert.equal(args[args.indexOf('-ss') + 1], '3600.000');
  assert.equal(args[args.indexOf('-c:v') + 1], 'copy');
  assert.equal(args[args.indexOf('-hls_list_size') + 1], '12');
  const flags = args[args.indexOf('-hls_flags') + 1];
  assert.ok(flags.includes('delete_segments'));
  assert.ok(flags.includes('temp_file'));
});

test('manual compatible audio selection forces remux to guarantee that track', () => {
  const mp4 = structuredClone(record);
  mp4.media.filename = 'test.mp4';
  mp4.media.container = 'mov,mp4,m4a,3gp,3g2,mj2';
  const plan = planPlayback(mp4, client, { forceOriginal: true, audioStreamIndex: 1 });
  assert.equal(plan.decision.mode, 'REMUX');
  assert.equal(plan.selected.audio.stream_index, 1);
});

test('text subtitle can remain external without video transcode', () => {
  const mp4 = structuredClone(record);
  mp4.media.filename = 'test.mp4';
  mp4.media.container = 'mp4';
  const plan = planPlayback(mp4, client, {
    forceOriginal: true,
    subtitlesEnabled: true,
    subtitleStreamIndex: 3
  });
  assert.equal(plan.decision.mode, 'DIRECT');
  assert.equal(plan.decision.subtitleAction, 'CONVERT');
  assert.equal(plan.selected.subtitle.action, 'WEBVTT');
});

test('PGS subtitle is allowed through the dedicated burn-in path', () => {
  const plan = planPlayback(record, client, {
    forceOriginal: true,
    subtitlesEnabled: true,
    subtitleStreamIndex: 4
  });
  assert.equal(plan.decision.mode, 'VIDEO_TRANSCODE');
  assert.equal(plan.decision.subtitleAction, 'BURN');
  assert.equal(plan.subtitleBurnIn, true);
  assert.equal(plan.decision.blocked, undefined);
  assert.equal(plan.selected.subtitle.action, 'BURN_IF_ENABLED');
});

test('PGS burn-in prefers VAAPI and keeps selected audio', () => {
  const plan = planPlayback(record, client, {
    forceOriginal: true,
    subtitlesEnabled: true,
    subtitleStreamIndex: 4
  });
  const args = buildHlsArgs(record, plan, '/tmp/test', 120, {
    burnInEncoder: 'vaapi',
    vaapiDevice: '/dev/dri/renderD128'
  });
  assert.equal(args[args.indexOf('-vaapi_device') + 1], '/dev/dri/renderD128');
  assert.equal(args[args.indexOf('-c:v') + 1], 'h264_vaapi');
  assert.equal(args[args.indexOf('-hls_time') + 1], '4');
  assert.equal(args[args.indexOf('-ss') + 1], '120.000');
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /\[0:0\]\[0:4\]overlay/);
  assert.match(filter, /hwupload/);
  assert.ok(args.includes('0:1'));
});

test('PGS burn-in has a software encoding fallback', () => {
  const plan = planPlayback(record, client, {
    forceOriginal: true,
    subtitlesEnabled: true,
    subtitleStreamIndex: 4
  });
  const args = buildHlsArgs(record, plan, '/tmp/test', 0, { burnInEncoder: 'software' });
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
  assert.ok(args.includes('veryfast'));
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /format=yuv420p/);
});

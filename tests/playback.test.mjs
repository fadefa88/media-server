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
    { stream_index: 3, codec_type: 'subtitle', codec_name: 'subrip', language: 'ita' }
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

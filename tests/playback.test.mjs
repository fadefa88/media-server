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
    bitrate_bps: 2400000
  },
  streams: [
    { stream_index: 0, codec_type: 'video', codec_name: 'hevc' },
    { stream_index: 1, codec_type: 'audio', codec_name: 'aac', channels: 6, is_default: true }
  ]
};

const client = {
  videoCodecs: ['h264', 'hevc'],
  audioCodecs: ['aac', 'ac3', 'eac3'],
  containers: ['mp4', 'mov', 'hls', 'fmp4'],
  subtitleFormats: ['srt', 'vtt'],
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
  const dts = structuredClone(record);
  dts.streams[1].codec_name = 'dts';
  const plan = planPlayback(dts, client, { forceOriginal: true });
  assert.equal(plan.decision.mode, 'AUDIO_TRANSCODE');
  const args = buildHlsArgs(dts, plan, '/tmp/test');
  assert.equal(args[args.indexOf('-c:v') + 1], 'copy');
  assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
});

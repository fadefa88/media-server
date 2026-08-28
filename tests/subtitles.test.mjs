import test from 'node:test';
import assert from 'node:assert/strict';
import { isTextSubtitleCodec, shiftWebVtt } from '../src/subtitles.mjs';

test('recognizes subtitle codecs that can be cached as WebVTT', () => {
  for (const codec of ['subrip','srt','ass','ssa','webvtt','vtt','mov_text']) {
    assert.equal(isTextSubtitleCodec(codec), true);
  }
  assert.equal(isTextSubtitleCodec('hdmv_pgs_subtitle'), false);
});

test('shiftWebVtt removes expired cues and shifts remaining cues', () => {
  const input = `WEBVTT\n\n00:00:05.000 --> 00:00:08.000\nold\n\n00:00:12.500 --> 00:00:15.000 align:start\ncurrent\n\n00:01:00.000 --> 00:01:03.250\nlater\n`;
  const output = shiftWebVtt(input, 10);

  assert.equal(output.includes('old'), false);
  assert.match(output, /00:00:02\.500 --> 00:00:05\.000 align:start/);
  assert.match(output, /00:00:50\.000 --> 00:00:53\.250/);
  assert.equal(output.startsWith('WEBVTT'), true);
});

test('shiftWebVtt clamps a cue already in progress to zero', () => {
  const input = `WEBVTT\n\n00:00:08.000 --> 00:00:12.000\nvisible now\n`;
  const output = shiftWebVtt(input, 10);
  assert.match(output, /00:00:00\.000 --> 00:00:02\.000/);
  assert.match(output, /visible now/);
});

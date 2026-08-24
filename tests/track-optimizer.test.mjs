import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeTracks } from '../src/track-optimizer.mjs';

test('prefers compatible AC3 over incompatible TrueHD', () => {
  const result = optimizeTracks([
    { codec_type: 'video', codec_name: 'hevc', stream_index: 0 },
    { codec_type: 'audio', codec_name: 'truehd', stream_index: 1, is_default: true, language: 'ita' },
    { codec_type: 'audio', codec_name: 'ac3', stream_index: 2, language: 'ita' }
  ], { audioCodecs: ['aac', 'ac3', 'eac3'] });

  assert.equal(result.audio.codec_name, 'ac3');
  assert.equal(result.audio.action, 'COPY');
});

test('prefers textual subtitles over PGS', () => {
  const result = optimizeTracks([
    { codec_type: 'video', codec_name: 'hevc', stream_index: 0 },
    { codec_type: 'subtitle', codec_name: 'hdmv_pgs_subtitle', stream_index: 3, is_default: true },
    { codec_type: 'subtitle', codec_name: 'subrip', stream_index: 4, language: 'ita' }
  ]);

  assert.equal(result.subtitle.codec_name, 'subrip');
  assert.equal(result.subtitle.action, 'TEXT');
});

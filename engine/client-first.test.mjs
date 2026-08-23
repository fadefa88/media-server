import assert from 'node:assert/strict';
import { decidePlayback } from './client-first.mjs';

const iphone = {
  videoCodecs: ['H.264', 'HEVC'],
  audioCodecs: ['AAC', 'AC3', 'EAC3'],
  containers: ['MP4', 'MOV', 'HLS', 'fMP4'],
  subtitleFormats: ['SRT', 'VTT'],
  hdrFormats: ['SDR', 'HDR', 'HDR10', 'Dolby Vision'],
  maxMbps: 100,
  networkMbps: 100,
  maxWidth: 3840,
  maxHeight: 2160
};

assert.equal(decidePlayback({codec:'HEVC',audioCodec:'AAC',container:'MP4',resolution:'4K',hdr:'HDR10',bitrate:35},iphone).mode,'DIRECT');
assert.equal(decidePlayback({codec:'HEVC',audioCodec:'AAC',container:'MKV',resolution:'4K',hdr:'HDR10',bitrate:35},iphone).mode,'REMUX');
const audioOnly = decidePlayback({codec:'HEVC',audioCodec:'DTS',container:'MKV',resolution:'4K',hdr:'HDR10',bitrate:35},iphone);
assert.equal(audioOnly.mode,'AUDIO_TRANSCODE');
assert.equal(audioOnly.videoAction,'COPY');
assert.equal(audioOnly.clientDecodesVideo,true);
assert.equal(decidePlayback({codec:'AV1',audioCodec:'AAC',container:'MKV',resolution:'4K',hdr:'HDR10',bitrate:25},iphone).mode,'VIDEO_TRANSCODE');
assert.equal(decidePlayback({codec:'HEVC',audioCodec:'AAC',container:'MP4',resolution:'4K',hdr:'HDR10',bitrate:60},{...iphone,networkMbps:12}).mode,'VIDEO_TRANSCODE');
const forced = decidePlayback({codec:'HEVC',audioCodec:'AAC',container:'MP4',resolution:'4K',hdr:'HDR10',bitrate:60},{...iphone,networkMbps:12},{forceOriginal:true});
assert.equal(forced.mode,'DIRECT');
assert.equal(forced.videoAction,'COPY');
assert.ok(forced.warning);
const pgs = decidePlayback({codec:'HEVC',audioCodec:'AAC',container:'MKV',resolution:'4K',hdr:'HDR10',bitrate:35,subtitleFormat:'PGS'},{...iphone,subtitlesEnabled:true,subtitleFormat:'PGS'});
assert.equal(pgs.mode,'VIDEO_TRANSCODE');

console.log('Client First Playback tests: OK');

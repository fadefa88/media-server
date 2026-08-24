import { spawn } from 'node:child_process';

const TEXT_SUBTITLE_CODECS = new Set(['subrip','srt','ass','ssa','webvtt','vtt','mov_text']);

export function isTextSubtitleCodec(codec) {
  return TEXT_SUBTITLE_CODECS.has(String(codec || '').toLowerCase());
}

export function streamSubtitleAsWebVtt({ record, streamIndex, offsetSeconds = 0, res }) {
  const track = record.streams.find(s => s.codec_type === 'subtitle' && Number(s.stream_index) === Number(streamIndex));
  if (!track) throw new Error('traccia sottotitoli non trovata');
  if (!isTextSubtitleCodec(track.codec_name)) throw new Error('questa traccia richiede burn-in e non e disponibile in WebVTT');

  const offset = Math.max(0, Number(offsetSeconds || 0));
  const args = ['-hide_banner','-loglevel','error','-nostdin'];
  if (offset > 0) args.push('-ss', String(offset));
  args.push('-i', record.media.path, '-map', `0:${track.stream_index}`, '-c:s', 'webvtt', '-f', 'webvtt', 'pipe:1');

  const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore','pipe','pipe'] });
  let stderr = '';
  ffmpeg.stderr.setEncoding('utf8');
  ffmpeg.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-4000); });

  res.writeHead(200, {
    'content-type': 'text/vtt; charset=utf-8',
    'cache-control': 'private, no-store'
  });

  ffmpeg.stdout.pipe(res);
  ffmpeg.on('error', error => res.destroy(error));
  ffmpeg.on('exit', code => {
    if (code !== 0 && !res.destroyed) res.destroy(new Error(stderr || `ffmpeg subtitle exit ${code}`));
  });

  res.on('close', () => {
    if (ffmpeg.exitCode === null) ffmpeg.kill('SIGTERM');
  });
}

const norm = value => String(value || '').trim().toLowerCase();

const DEFAULT_AUDIO = ['aac', 'ac3', 'eac3', 'mp3', 'alac'];
const TEXT_SUBTITLES = ['subrip', 'srt', 'webvtt', 'vtt', 'ass', 'ssa'];

function languageScore(language, preferences = []) {
  const lang = norm(language);
  const index = preferences.map(norm).findIndex(x => x === lang);
  return index < 0 ? 0 : 40 - index;
}

export function optimizeTracks(streams = [], client = {}) {
  const videoCodecs = new Set((client.videoCodecs || ['h264', 'hevc']).map(norm));
  const audioCodecs = new Set((client.audioCodecs || DEFAULT_AUDIO).map(norm));
  const audioLanguages = client.audioLanguages || ['ita', 'it', 'eng', 'en'];
  const subtitleLanguages = client.subtitleLanguages || ['ita', 'it', 'eng', 'en'];

  const videos = streams.filter(s => s.codec_type === 'video');
  const audios = streams.filter(s => s.codec_type === 'audio');
  const subtitles = streams.filter(s => s.codec_type === 'subtitle');

  const video = videos[0] || null;

  const scoredAudio = audios.map(track => {
    const compatible = audioCodecs.has(norm(track.codec_name));
    const score =
      (compatible ? 100 : 0) +
      (track.is_default ? 20 : 0) +
      languageScore(track.language, audioLanguages);
    return { track, compatible, score };
  }).sort((a, b) => b.score - a.score);

  const audio = scoredAudio[0] || null;

  const scoredSubs = subtitles.map(track => {
    const textual = TEXT_SUBTITLES.includes(norm(track.codec_name));
    const score =
      (textual ? 100 : 0) +
      (track.is_forced ? 25 : 0) +
      (track.is_default ? 10 : 0) +
      languageScore(track.language, subtitleLanguages);
    return { track, textual, score };
  }).sort((a, b) => b.score - a.score);

  const subtitle = scoredSubs[0] || null;

  return {
    video: video ? {
      ...video,
      compatible: videoCodecs.has(norm(video.codec_name))
    } : null,
    audio: audio ? {
      ...audio.track,
      compatible: audio.compatible,
      action: audio.compatible ? 'COPY' : 'TRANSCODE_AAC'
    } : null,
    subtitle: subtitle ? {
      ...subtitle.track,
      textual: subtitle.textual,
      action: subtitle.textual ? 'TEXT' : 'BURN_IF_ENABLED'
    } : null
  };
}

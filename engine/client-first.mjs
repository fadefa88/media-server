const norm = value => String(value ?? '').trim().toLowerCase();
const set = values => new Set((values || []).map(norm));

/**
 * VELA Client First Playback.
 * Priority: DIRECT -> REMUX -> AUDIO_TRANSCODE -> VIDEO_TRANSCODE.
 * The video stream is copied untouched whenever the client can decode it.
 */
export function decidePlayback(media, client = {}, options = {}) {
  const forceOriginal = options.forceOriginal ?? client.forceOriginal ?? false;
  const subtitlesEnabled = options.subtitlesEnabled ?? client.subtitlesEnabled ?? false;
  const subtitleFormat = norm(options.subtitleFormat || client.subtitleFormat || media.subtitleFormat || '');

  const videoCodecs = set(client.videoCodecs || ['h264', 'h.264', 'hevc']);
  const audioCodecs = set(client.audioCodecs || ['aac', 'ac3', 'eac3']);
  const containers = set(client.containers || ['mp4', 'mov', 'hls', 'fmp4']);
  const subtitleFormats = set(client.subtitleFormats || ['srt', 'vtt', 'webvtt']);
  const hdrFormats = set(client.hdrFormats || ['sdr', 'hdr', 'hdr10', 'dolby vision', 'dolbyvision']);

  const videoCodec = norm(media.videoCodec || media.codec);
  const audioCodec = norm(media.audioCodec || media.audio || 'aac');
  const container = norm(media.container);
  const hdr = norm(media.hdr || 'sdr');
  const bitrate = Number(media.bitrate || 0);
  const width = Number(media.width || (String(media.resolution).toLowerCase().includes('4k') ? 3840 : 1920));
  const height = Number(media.height || (String(media.resolution).toLowerCase().includes('4k') ? 2160 : 1080));

  const maxMbps = Number(client.maxMbps || 1000);
  const networkMbps = Number(client.networkMbps || maxMbps);
  const budgetMbps = Math.max(2, Math.min(maxMbps, networkMbps * 0.82));
  const maxWidth = Number(client.maxWidth || 7680);
  const maxHeight = Number(client.maxHeight || 4320);

  const aliases = new Set([videoCodec]);
  if (videoCodec === 'h.264') aliases.add('h264');
  if (videoCodec === 'h264') aliases.add('h.264');

  const videoCompatible = [...aliases].some(codec => videoCodecs.has(codec)) &&
    width <= maxWidth && height <= maxHeight && (hdr === 'sdr' || hdrFormats.has(hdr));
  const audioCompatible = audioCodecs.has(audioCodec);
  const containerCompatible = containers.has(container);
  const bandwidthCompatible = !bitrate || bitrate <= budgetMbps;

  let subtitleAction = 'OFF';
  let subtitleNeedsBurn = false;
  if (subtitlesEnabled && subtitleFormat) {
    if (subtitleFormats.has(subtitleFormat)) subtitleAction = 'DIRECT';
    else if (['srt', 'ass', 'ssa', 'vtt', 'webvtt'].includes(subtitleFormat)) subtitleAction = 'CONVERT';
    else {
      subtitleAction = 'BURN';
      subtitleNeedsBurn = true;
    }
  }

  const base = {
    policy: 'client-first',
    originalRequested: Boolean(forceOriginal),
    clientDecodesVideo: false,
    qualityPreserved: false,
    subtitleAction,
    budgetMbps: Math.round(budgetMbps * 10) / 10
  };

  if (videoCompatible && !subtitleNeedsBurn && (forceOriginal || bandwidthCompatible)) {
    if (audioCompatible && containerCompatible && subtitleAction !== 'CONVERT') {
      return {
        ...base,
        mode: 'DIRECT',
        videoAction: 'COPY', audioAction: 'COPY', containerAction: 'COPY',
        clientDecodesVideo: true, qualityPreserved: true, cpuImpact: 'MINIMAL',
        target: 'Originale',
        warning: !bandwidthCompatible ? 'Banda stimata sotto il bitrate originale: possibili buffer.' : null,
        reason: 'Il dispositivo decodifica direttamente video e audio.'
      };
    }

    if (!audioCompatible) {
      return {
        ...base,
        mode: 'AUDIO_TRANSCODE',
        videoAction: 'COPY', audioAction: 'TRANSCODE_AAC',
        containerAction: containerCompatible ? 'COPY' : 'REMUX_FMP4_HLS',
        clientDecodesVideo: true, qualityPreserved: true, cpuImpact: 'LOW',
        target: 'Video originale · audio AAC',
        warning: !bandwidthCompatible ? 'Banda stimata sotto il bitrate originale: possibili buffer.' : null,
        reason: 'Il video è compatibile: VELA converte soltanto l’audio.'
      };
    }

    return {
      ...base,
      mode: 'REMUX',
      videoAction: 'COPY', audioAction: 'COPY', containerAction: 'REMUX_FMP4_HLS',
      clientDecodesVideo: true, qualityPreserved: true, cpuImpact: 'MINIMAL',
      target: 'Qualità originale · fMP4/HLS',
      warning: !bandwidthCompatible ? 'Banda stimata sotto il bitrate originale: possibili buffer.' : null,
      reason: subtitleAction === 'CONVERT'
        ? 'Video e audio restano originali; VELA adatta contenitore/sottotitoli.'
        : 'Il video è compatibile: VELA cambia soltanto il contenitore.'
    };
  }

  const targetMbps = Math.max(3, Math.min(12, Math.floor(budgetMbps)));
  const reason = subtitleNeedsBurn
    ? 'Il formato sottotitoli richiede compositing sul video.'
    : !videoCompatible
      ? 'Il client non può decodificare in modo compatibile il video originale.'
      : 'In Auto la rete non sostiene il bitrate originale.';

  return {
    ...base,
    mode: 'VIDEO_TRANSCODE',
    videoAction: 'TRANSCODE',
    audioAction: audioCompatible ? 'COPY' : 'TRANSCODE_AAC',
    containerAction: 'HLS',
    clientDecodesVideo: false,
    qualityPreserved: false,
    cpuImpact: 'HIGH',
    target: `1080p · ${targetMbps} Mbps`,
    reason
  };
}

# VELA Client First Playback

VELA preserves the original video stream whenever the playback device can decode it.

Decision order:

1. **DIRECT** — video/audio/container are compatible. The device decodes the original stream.
2. **REMUX** — video/audio are compatible but the container or text subtitles need adaptation. Video is copied unchanged to fMP4/HLS.
3. **AUDIO_TRANSCODE** — video is compatible but audio is not. Video is copied unchanged; only audio is converted, normally to AAC.
4. **VIDEO_TRANSCODE** — last resort only: unsupported video/HDR, bitmap subtitles requiring burn-in, or insufficient bandwidth in Auto mode.

The playback decision exposes `videoAction`, `audioAction`, `containerAction`, `clientDecodesVideo`, `qualityPreserved`, `cpuImpact`, `target`, `warning`, and `reason` so the UI can explain exactly what VELA is doing.

`forceOriginal` keeps the original video whenever the client can decode it even when estimated bandwidth is below the source bitrate; VELA returns a buffering warning rather than silently lowering video quality.

This public repository contains only the UI prototype and playback decision logic. Real media paths, credentials, authentication secrets and home infrastructure must remain outside the public repository.

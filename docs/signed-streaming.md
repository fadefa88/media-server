# Signed external streaming

When `STREAM_SIGNING_SECRET` is configured, LDF issues temporary bearer capabilities for playback URLs without changing the Client First playback decision.

- DIRECT keeps `/stream/<mediaId>` and adds an HMAC signature plus expiry in the query string.
- HLS uses a signed, expiring session id in `/playback/<sessionId>/...`, so `index.m3u8`, `init.mp4` and relative `.m4s` segments share the same capability.
- A valid signed playback capability is accepted without the normal LDF session cookie, but it authorizes only the existing `/stream/*` or `/playback/*` route.
- With signing disabled, URLs and session ids keep their previous behavior.

This design intentionally keeps playback URLs relative. The LAN path can therefore stay local, while the public nginx listener can redirect only `/stream/*` and `/playback/*` to the separate `stream.lucahome.uk` relay using `$request_uri`.

Recommended environment:

```env
STREAM_SIGNING_SECRET=<at least 32 random characters>
STREAM_SIGNING_TTL_SECONDS=21600
```

Generate a secret with `openssl rand -hex 32` and keep it only in the server environment.

# VELA deploy su Proxmox LXC

Target attuale:

- Proxmox VE 9
- LXC Debian 13 non privilegiato
- `/media` montato read-only
- `/dev/dri/renderD128` passato al CT
- Docker Engine + Compose
- 1 GB RAM durante la fase di sviluppo
- video transcoding disabilitato

## Layout host LXC

```text
/opt/vela/
  app/          repository Git
  config/.env   secret locali, fuori da Git
  data/         PostgreSQL
  cache/
  transcode/
  backups/
```

## Configurazione

Creare `/opt/vela/config/.env` partendo da `.env.example`.

Obbligatori:

- `SESSION_SECRET`
- `POSTGRES_PASSWORD`

Con 8 GB host lasciare:

```env
VIDEO_TRANSCODE_ENABLED=false
SOFTWARE_VIDEO_TRANSCODE=false
```

## Avvio

```bash
cd /opt/vela/app
docker compose config
docker compose build
docker compose up -d
docker stats --no-stream
```

Health:

```bash
curl http://127.0.0.1:4173/api/health
```

UI:

```text
http://IP_DEL_CT:4173/
```

## Scanner

```bash
curl -X POST http://127.0.0.1:4173/api/scan \
  -H 'content-type: application/json' \
  -d '{"limit":10}'
```

Stato:

```bash
curl http://127.0.0.1:4173/api/scan/status
```

## Playback v0.3

VELA supporta ora:

- `DIRECT`: file originale con HTTP Range.
- `REMUX`: video e audio copiati in HLS/fMP4 senza ricodifica.
- `AUDIO_TRANSCODE`: video copiato, solo audio convertito in AAC.
- `VIDEO_TRANSCODE`: ancora bloccato quando `VIDEO_TRANSCODE_ENABLED=false`.

Il remux HLS viene scritto temporaneamente sotto `/opt/vela/transcode/<session-id>` e rimosso alla chiusura della sessione o dopo il TTL.

Test API manuale:

```bash
curl -X POST http://127.0.0.1:4173/api/media/ID/playback \
  -H 'content-type: application/json' \
  -d '{"forceOriginal":true}'
```

La risposta contiene `DIRECT` oppure una URL HLS `/playback/<session>/index.m3u8`.

In v0.3 i sottotitoli non vengono ancora inseriti nella pipeline HLS: arriveranno come tracce WebVTT separate. I sottotitoli bitmap resteranno un caso di burn-in futuro.

## Aggiornamento del server

```bash
cd /opt/vela/app
git pull --ff-only
docker compose build vela
docker compose up -d
curl -s http://127.0.0.1:4173/api/health | jq
```

Database e secret non vengono ricreati: vivono fuori dal repository in `/opt/vela/data` e `/opt/vela/config`.

## Sicurezza

Questa fase è solo LAN. Non esporre la porta 4173 a Internet.

Autenticazione, passkey, signed playback sessions e HTTPS arrivano prima dell'esposizione remota.

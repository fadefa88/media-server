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

## Primo avvio

```bash
cd /opt/vela/app
docker compose config
docker compose build
docker compose up -d postgres
docker stats --no-stream
docker compose up -d vela
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

## Scanner graduale

Dalla UI usare prima 10, poi 100, poi tutta la libreria.

Oppure:

```bash
curl -X POST http://127.0.0.1:4173/api/scan \
  -H 'content-type: application/json' \
  -d '{"limit":10}'
```

Stato:

```bash
curl http://127.0.0.1:4173/api/scan/status
```

## Sicurezza

Questa fase è solo LAN. Non esporre la porta 4173 a Internet.

Autenticazione, passkey, signed playback sessions e HTTPS arrivano prima dell'esposizione remota.

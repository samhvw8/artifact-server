---
type: Deployment
title: Artifact Server on 3cxo
description: Layout of the live installation on host 3cxo — domains, containers, nginx, certificates, login, and backups.
resource: ssh://root@36.50.176.213
tags: [deployment, 3cxo, nginx, certbot, docker]
status: stable
generated: { by: claude-code/opus-5.5, at: '2026-10-01T07:10:00Z' }
stale_after: 2026-12-29
sources:
  - id: host-inspection
    resource: ssh://3cxo
    title: Inspection of /opt/artifact-server, /etc/nginx, /etc/letsencrypt on 2026-10-01
  - id: setup-session
    resource: claude-session:36f0852c-687a-43d6-b733-f32608d4f657
    title: Original setup session (Artifact alternative self-hosting)
---

# Overview

One private installation for a single owner, on Ubuntu (`x86_64`) host `3cxo`
(`36.50.176.213`, ssh alias `3cxo`, user `root`).[^host-inspection]

# Domains

| Host | Purpose | DNS (Cloudflare zone `3cxo.work`) |
|------|---------|-----------------------------------|
| `artifacts.3cxo.work` | Application, API, MCP (`/mcp`), review UI | A → 36.50.176.213, DNS-only |
| `*.art.3cxo.work` | Published content: version tokens and [short names](/features/short-names.md) | A → 36.50.176.213, DNS-only |
| `id.3cxo.work` | Pocket ID (OIDC login, passkeys) | A → 36.50.176.213, DNS-only |

Pages share `3cxo.work` with the app through
[same-site content](/features/same-site-content.md). Content used to live on
`*.art.voxtract.app`; that DNS record, certificate and nginx site were removed
on 2026-10-01 so `voxtract.app` stays with its own product.

# Services

| Path | What |
|------|------|
| `/opt/artifact-server/` | `compose.yaml`, `.env` (secrets, mode 600), upstream backup/restore scripts, `.env.bak-*` and `compose.yaml.bak-*` |
| `/opt/artifact-server-src/` | Source tree shipped by each deploy; images are built here |
| Docker volume `artifact-server_artifact-server-data` | Data: `data/artifact-server.db` (SQLite) and blobs |
| Container `artifact-server-app` | Image `local/artifact-server:<rev>-<timestamp>`, listens on `127.0.0.1:8787` |
| `/opt/pocket-id/` | Pocket ID v2.16.0 on `127.0.0.1:1411` (Docker) |

Key `.env` settings (values other than secrets):

```dotenv
ARTIFACT_SERVER_ORIGIN=https://artifacts.3cxo.work
ARTIFACT_SERVER_CONTENT_DOMAIN=art.3cxo.work
ARTIFACT_SERVER_ALLOW_SAME_SITE_CONTENT=true
ARTIFACT_SERVER_ALLOW_TEST_IMAGE_TAG=true   # lets the backup script accept local image tags
```

Docker comes from Ubuntu packages (`docker.io`, `docker-compose-v2`,
`docker-buildx`). Login is OIDC through Pocket ID with a public PKCE client;
sign-ups are disabled and only the owner is admitted.[^setup-session]

# nginx and TLS

| Site (`/etc/nginx/sites-enabled/`) | Certificate | Renewal |
|-------------------------------------|-------------|---------|
| `artifacts.3cxo.work` | Let's Encrypt (HTTP) | certbot timer |
| `art.3cxo.work` (`server_name *.art.3cxo.work`) | Let's Encrypt wildcard `*.art.3cxo.work`, ECDSA | certbot `dns-cloudflare`, token in `/root/.secrets/cloudflare.ini` |
| `id.3cxo.work` | Let's Encrypt | certbot timer |

Both sites proxy to `127.0.0.1:8787` with `Host` and `X-Forwarded-*` headers.
Records are DNS-only because Cloudflare's free proxy certificate does not cover
two-level wildcards. The certbot token is also saved on the Mac as
`~/creds/cloudflare-certbot-voxtract-dns` (the name predates the move) and can
edit DNS in both `3cxo.work` and `voxtract.app`.

# Backups

- Each deploy runs upstream's `compact-backup.sh` into
  `/srv/backups/artifact-server/pre-deploy-<timestamp>/` (about 370 MB each)
  and keeps the five newest.
- A one-off backup from before the same-site switch is in
  `pre-samesite-20261001-0332/`.
- The nightly backup cron from the original setup was broken and has not
  been fixed.

# Operations

- Deploy: [/playbooks/deploy-to-3cxo.md](/playbooks/deploy-to-3cxo.md)
- Upstream releases: [/playbooks/sync-upstream.md](/playbooks/sync-upstream.md)
- Health: `curl https://artifacts.3cxo.work/ready` returns 200.

# Open items

- Old images (about 1.25 GB each) build up in Docker; prune them by hand.
- Running without Docker (Node under systemd) was proposed and not decided.
  Docker stays installed either way while Pocket ID uses it.

[^host-inspection]: Inspection of /opt/artifact-server, /etc/nginx, /etc/letsencrypt on 2026-10-01
[^setup-session]: Original setup session (Artifact alternative self-hosting)

---
type: Deployment
title: Artifact Server on 3cxo
description: Layout of the live installation on host 3cxo — domains, the Podman quadlet unit, nginx, certificates, login, and backups.
resource: ssh://root@36.50.176.213
tags: [deployment, 3cxo, nginx, certbot, podman, quadlet]
status: stable
generated: { by: claude-code/opus-5.5, at: '2026-10-21T08:30:00Z' }
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

Since 2026-10-21 the server runs under rootful **Podman** as a systemd
quadlet unit; Docker is masked on the host. The host side is documented in the
infra bundle (`~/workspace/infra/.okf/servers/3cxo.md`, section "Containers
(Podman)", and `decisions/containers-on-3cxo.md`).

| Path | What |
|------|------|
| `/etc/containers/systemd/artifact-server.container` | Quadlet → `artifact-server.service`. Same hardening as upstream's compose file (read-only root, `/tmp` tmpfs 32 MB noexec, user 1000:1000, `cap-drop all`, `no-new-privileges`, init, 256 pids, 15 s stop). `Image=` is rewritten by each deploy. `Notify=healthy` with a 2 s startup check, so `systemctl restart` returns once `/health` passes |
| `/opt/artifact-server/container.env` | Settings (mode 600): exactly the variables the compose setup passed to the container |
| `/opt/artifact-server/artifact-server.container.bak-*` | Quadlet copies saved by each deploy, for rollback |
| `/opt/artifact-server/docker-retired/` | The old `compose.yaml`, `.env`, upstream `compact-*.sh` scripts |
| `/opt/artifact-server-src/` | Source tree shipped by each deploy; images are built here with `podman build` |
| `/var/lib/artifact-server` | Data bind mount: `data/artifact-server.db` (SQLite) and blobs. Copied from the Docker volume `artifact-server_artifact-server-data` on 2026-10-21 |
| Container `artifact-server-app` | Image `localhost/artifact-server:<rev>-<timestamp>`, listens on `127.0.0.1:8787` |
| `/opt/pocket-id/` | Pocket ID v2.16.0 on `127.0.0.1:1411` (Podman quadlet `pocket-id.service`) |

Key settings in `container.env` (values other than secrets):

```dotenv
ARTIFACT_SERVER_ORIGIN=https://artifacts.3cxo.work
ARTIFACT_SERVER_CONTENT_DOMAIN=art.3cxo.work
ARTIFACT_SERVER_ALLOW_SAME_SITE_CONTENT=true
ARTIFACT_SERVER_SESSION_LIFETIME_HOURS=720   # 30-day browser login, see /features/session-lifetime.md
```

Podman 5.7 comes from Ubuntu 26.04 packages. Login is OIDC through Pocket ID with a public PKCE client;
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

- `/usr/local/sbin/artifact-server-backup DIR` replaces upstream's
  compose-based `compact-backup.sh` with the same layout (`data.tar`,
  `data.tar.sha256`, `support-manifest.json`); it stops the unit for about a
  minute. `/usr/local/sbin/artifact-server-restore DIR` replaces
  `compact-restore.sh` and keeps its checks.
- Nightly: `backup-artifacts.timer` (03:30 UTC) into
  `/srv/backups/artifact-server/<date>/`, 14 days kept, Telegram alert on
  failure. The old cron never succeeded; the first good nightly run was
  2026-10-21.
- Each deploy backs up into
  `/srv/backups/artifact-server/pre-deploy-<timestamp>/` (about 1.4 GB each
  now) and keeps the five newest. `pre-podman-20261021-074644/` was taken by
  the upstream script just before the move to Podman.
- A one-off backup from before the same-site switch is in
  `pre-samesite-20261001-0332/`.

# Operations

- Deploy: [/playbooks/deploy-to-3cxo.md](/playbooks/deploy-to-3cxo.md)
- Upstream releases: [/playbooks/sync-upstream.md](/playbooks/sync-upstream.md)
- Health: `curl https://artifacts.3cxo.work/ready` returns 200.

# Open items

- `integrity check` reports `corrupt` since a version saved after 2026-10-15:
  `manifest_invalid` ("The saved manifest does not match its stored entries")
  for `art_3e10ed4c…`/`ver_6e7e7083…` and `art_f0bd4dc7…`/`ver_16436d77…`.
  The 2026-10-15 pre-deploy backup is healthy. The restore script refuses any
  backup that fails the check, so fix these two versions before a restore is
  needed.
- The deploy keeps the three newest images; build cache layers stay until
  `podman image prune -a`.

[^host-inspection]: Inspection of /opt/artifact-server, /etc/nginx, /etc/letsencrypt on 2026-10-01
[^setup-session]: Original setup session (Artifact alternative self-hosting)

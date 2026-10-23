---
type: Playbook
title: Deploy the fork to 3cxo
description: Build the current checkout on 3cxo with Podman, back up the data, point the quadlet unit at the new image, and roll back if needed.
resource: deploy/3cxo/deploy.sh
tags: [deployment, playbook, 3cxo]
status: stable
generated: { by: claude-code/opus-5.5, at: '2026-10-21T08:30:00Z' }
sources:
  - id: deploy
    resource: deploy/3cxo/deploy.sh
    title: Local half of the deploy
  - id: remote
    resource: deploy/3cxo/remote-build.sh
    title: Remote half of the deploy
---

# Trigger

Any change on branch `3cxo` that should go live on
[3cxo](/deployment/3cxo-host.md).

# Steps

1. Run the checks the change touches, at minimum
   `pnpm typecheck && pnpm lint && pnpm test`.
2. From the repository root, run:

   ```bash
   deploy/3cxo/deploy.sh                       # host defaults to the ssh alias 3cxo
   ARTIFACT_DEPLOY_HOST=other deploy/3cxo/deploy.sh
   ```

3. It prints `Running localhost/artifact-server:<rev>-<timestamp>`, a `Rollback:`
   command, and `ready: 200`. It exits non-zero if the container is not
   running the new image.

# What it does

Local half:[^deploy]

1. Tags the image `localhost/artifact-server:<short sha>[-dirty]-<timestamp>`.
2. Ships tracked files from the working tree (`git ls-files`) to
   `/opt/artifact-server-src`. Untracked files are **not** shipped, so commit
   new files first.
3. Runs `deploy/3cxo/remote-build.sh` on the host from the shipped tree.
4. Fails unless `artifact-server-app` runs the new tag, then checks `/ready`.

Remote half:[^remote]

1. Upstream's Dockerfile pins the checksum of the AWS RDS CA bundle, and AWS
   republished it. When the running image's copy matches the pin, the script
   writes `packaging/oci/Dockerfile.3cxo`, which `COPY`s that file instead of
   downloading it. Otherwise it builds the upstream Dockerfile unchanged.
2. `podman build` (buildah inside Podman handles `--platform=$BUILDPLATFORM`
   and `RUN --mount=type=cache`; the `# syntax=` line is ignored).
3. Backs up with the host's `/usr/local/sbin/artifact-server-backup` into
   `/srv/backups/artifact-server/pre-deploy-<timestamp>`.
4. Saves `/opt/artifact-server/artifact-server.container.bak-<stamp>`, sets
   `Image=` in `/etc/containers/systemd/artifact-server.container`, runs
   `systemctl daemon-reload` and `systemctl restart artifact-server`, which
   returns only once the new container is healthy (`Notify=healthy`).
5. Keeps the three newest artifact-server images and prunes dangling layers.

Tested on 2026-10-21 by rebuilding the running revision (`a885c84-dirty`)
from the shipped tree: 272 s end to end, `/ready` 200.

# Rollback

Run the printed command on the host:

```bash
cp /opt/artifact-server/artifact-server.container.bak-<stamp> /etc/containers/systemd/artifact-server.container \
  && systemctl daemon-reload && systemctl restart artifact-server
```

To restore data as well, use `/usr/local/sbin/artifact-server-restore` with a
backup directory (usage in its header).

# Pitfalls already hit

The first three rows date from the Docker era (before 2026-10-21); the
fixes still shape the scripts.

| Symptom | Cause | Fix in place |
|---------|-------|--------------|
| Deploy stopped after the backup but printed `ready` | The remote script was piped over ssh stdin and `docker compose` consumed the rest | Remote steps run from a shipped file; compose calls get `</dev/null` |
| New image built but old one started | `set -a; . ./.env` exported the old `ARTIFACT_SERVER_IMAGE`, which overrides `.env` for compose | `.env` is sourced only in the backup subshell |
| `docker build` failed on `--platform=$BUILDPLATFORM` | Legacy builder | `docker-buildx` installed (Docker era; `podman build` handles it) |
| A shell-form `HealthCmd=` with quotes broke in the quadlet | quadlet drops a closing `"` and keeps outer quotes literally | JSON form without outer quotes: `HealthCmd=["node","-e","…"]`, backticks inside the JS |

[^deploy]: Local half of the deploy
[^remote]: Remote half of the deploy

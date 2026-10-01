---
type: Playbook
title: Deploy the fork to 3cxo
description: Build the current checkout on 3cxo, back up the data, switch the container to the new image, and roll back if needed.
resource: deploy/3cxo/deploy.sh
tags: [deployment, playbook, 3cxo]
status: stable
generated: { by: claude-code/opus-5.5, at: '2026-10-01T07:10:00Z' }
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

3. It prints `Running local/artifact-server:<rev>-<timestamp>`, a `Rollback:`
   command, and `ready: 200`. It exits non-zero if the container is not
   running the new image.

# What it does

Local half:[^deploy]

1. Tags the image `local/artifact-server:<short sha>[-dirty]-<timestamp>`.
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
2. `docker buildx build --load`.
3. Backs up with `compact-backup.sh` into
   `/srv/backups/artifact-server/pre-deploy-<timestamp>`. `.env` is loaded
   only inside a subshell for this step.
4. Saves `.env.bak-<stamp>` and `compose.yaml.bak-<stamp>`, installs
   `packaging/compose/compose.yaml`, sets `ARTIFACT_SERVER_IMAGE`, and runs
   `docker compose up -d --wait`.

# Rollback

Run the printed command in `/opt/artifact-server`:

```bash
cp .env.bak-<stamp> .env && cp compose.yaml.bak-<stamp> compose.yaml && docker compose up -d
```

To restore data as well, use upstream's `compact-restore.sh` with a backup
directory.

# Pitfalls already hit

| Symptom | Cause | Fix in place |
|---------|-------|--------------|
| Deploy stopped after the backup but printed `ready` | The remote script was piped over ssh stdin and `docker compose` consumed the rest | Remote steps run from a shipped file; compose calls get `</dev/null` |
| New image built but old one started | `set -a; . ./.env` exported the old `ARTIFACT_SERVER_IMAGE`, which overrides `.env` for compose | `.env` is sourced only in the backup subshell |
| `docker build` failed on `--platform=$BUILDPLATFORM` | Legacy builder | `docker-buildx` installed |

[^deploy]: Local half of the deploy
[^remote]: Remote half of the deploy

#!/usr/bin/env bash
# Build this checkout on the 3cxo host and restart Artifact Server on it.
#
# Ships the tracked files (working-tree contents) to /opt/artifact-server-src,
# builds the OCI image there, backs up the data, then points
# /opt/artifact-server/.env at the new image and restarts the container.
#
# Usage: deploy/3cxo/deploy.sh            (host defaults to the `3cxo` ssh alias)
#        ARTIFACT_DEPLOY_HOST=other deploy/3cxo/deploy.sh

set -euo pipefail

host=${ARTIFACT_DEPLOY_HOST:-3cxo}
origin=${ARTIFACT_DEPLOY_ORIGIN:-https://artifacts.3cxo.work}
repository=$(git rev-parse --show-toplevel)
cd "$repository"

revision=$(git rev-parse --short HEAD)
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  revision="${revision}-dirty"
fi
tag="local/artifact-server:${revision}"

printf 'Shipping %s to %s\n' "$revision" "$host"
git ls-files -z | tar --null -czf - -T - | ssh "$host" \
  'rm -rf /opt/artifact-server-src && mkdir -p /opt/artifact-server-src && tar -xzf - -C /opt/artifact-server-src'

# The remote steps run from a shipped file, not stdin: docker compose reads
# stdin, which would swallow the rest of a piped script.
ssh "$host" bash /opt/artifact-server-src/deploy/3cxo/remote-build.sh "$tag" "$revision"

running=$(ssh "$host" docker inspect artifact-server-app --format '{{.Config.Image}}')
if [[ "$running" != "$tag" ]]; then
  printf 'Deploy failed: the container runs %s, expected %s.\n' "$running" "$tag" >&2
  exit 1
fi
curl -fsS -o /dev/null -w 'ready: %{http_code}\n' "$origin/ready"

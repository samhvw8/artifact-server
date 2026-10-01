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

ssh "$host" bash -s -- "$tag" "$revision" <<'REMOTE'
set -euo pipefail
tag=$1
revision=$2
source_directory=/opt/artifact-server-src
compose_directory=/opt/artifact-server
cd "$source_directory"

# Upstream's Dockerfile downloads the AWS RDS CA bundle and pins its checksum.
# When AWS republishes the bundle the pin breaks the build, so reuse the
# pinned bytes from the running image whenever they still match the pin.
dockerfile=packaging/oci/Dockerfile
pem=packaging/oci/aws-rds-global-bundle.pem
pinned=$(grep -o 'checksum=sha256:[0-9a-f]*' "$dockerfile" | cut -d: -f2)
running=$(grep '^ARTIFACT_SERVER_IMAGE=' "$compose_directory/.env" | cut -d= -f2-)
container=$(docker create "$running")
docker cp "$container:/usr/local/share/ca-certificates/aws-rds-global-bundle.pem" "$pem"
docker rm "$container" >/dev/null
if [[ "$(sha256sum "$pem" | cut -d' ' -f1)" == "$pinned" ]]; then
  python3 - "$dockerfile" <<'PY'
import re, sys
path = sys.argv[1]
source = open(path).read()
rewritten = re.sub(
    r"ADD --checksum=sha256:[0-9a-f]+ \\\n\s+https://truststore\S+ \\\n\s+(\S+)",
    r"COPY packaging/oci/aws-rds-global-bundle.pem \1",
    source,
)
if rewritten == source:
    sys.exit("The RDS bundle ADD instruction was not found in the Dockerfile.")
open(path + ".3cxo", "w").write(rewritten)
PY
  dockerfile="$dockerfile.3cxo"
fi

docker buildx build --load -f "$dockerfile" \
  --build-arg IMAGE_REVISION="$revision" \
  --build-arg IMAGE_VERSION="$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')-3cxo" \
  -t "$tag" .

cd "$compose_directory"
set -a
# shellcheck disable=SC1091
. ./.env
set +a
backup="/srv/backups/artifact-server/pre-deploy-$(date +%Y%m%d-%H%M%S)"
./compact-backup.sh "$backup"
# Keep the five newest pre-deploy backups.
find /srv/backups/artifact-server -maxdepth 1 -name 'pre-deploy-*' -type d \
  | sort | head -n -5 | xargs -r rm -rf

cp -p .env ".env.bak-$(date +%Y%m%d-%H%M%S)"
sed -i "s|^ARTIFACT_SERVER_IMAGE=.*|ARTIFACT_SERVER_IMAGE=$tag|" .env
docker compose up -d --wait artifact-server
printf 'Running %s; backup at %s\n' "$tag" "$backup"
REMOTE

curl -fsS -o /dev/null -w 'ready: %{http_code}\n' "$origin/ready"

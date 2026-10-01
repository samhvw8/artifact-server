#!/usr/bin/env bash
# Remote half of deploy/3cxo/deploy.sh. Runs on the host from the shipped
# source tree: builds the image, backs up the data, switches .env to the new
# image, and restarts the container.
#
# Usage: remote-build.sh IMAGE_TAG REVISION

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
if ! grep -q '^ARTIFACT_SERVER_IMAGE=' .env; then
  echo "ARTIFACT_SERVER_IMAGE is missing from $compose_directory/.env." >&2
  exit 1
fi
backup="/srv/backups/artifact-server/pre-deploy-$(date +%Y%m%d-%H%M%S)"
# Load .env only inside this subshell: an exported ARTIFACT_SERVER_IMAGE
# would override .env for the docker compose call below.
(
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  ./compact-backup.sh "$backup" </dev/null
)
# Keep the five newest pre-deploy backups.
find /srv/backups/artifact-server -maxdepth 1 -name 'pre-deploy-*' -type d \
  | sort | head -n -5 | xargs -r rm -rf

stamp=$(date +%Y%m%d-%H%M%S)
cp -p .env ".env.bak-$stamp"
cp -p compose.yaml "compose.yaml.bak-$stamp"
install -m 0644 "$source_directory/packaging/compose/compose.yaml" compose.yaml
sed -i "s|^ARTIFACT_SERVER_IMAGE=.*|ARTIFACT_SERVER_IMAGE=$tag|" .env
printf 'Rollback: cp %s/.env.bak-%s .env && cp %s/compose.yaml.bak-%s compose.yaml && docker compose up -d\n' \
  "$compose_directory" "$stamp" "$compose_directory" "$stamp"
docker compose up -d --wait artifact-server </dev/null
printf 'Running %s; backup at %s\n' "$tag" "$backup"

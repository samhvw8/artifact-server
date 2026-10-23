#!/usr/bin/env bash
# Remote half of deploy/3cxo/deploy.sh. Runs on the host from the shipped
# source tree: builds the image with Podman, backs up the data, points the
# artifact-server quadlet at the new image, and restarts the unit.
#
# Usage: remote-build.sh IMAGE_TAG REVISION

set -euo pipefail
tag=$1
revision=$2
source_directory=/opt/artifact-server-src
quadlet=/etc/containers/systemd/artifact-server.container
cd "$source_directory"

running=$(sed -n 's/^Image=//p' "$quadlet")
if [[ -z "$running" ]]; then
  echo "No Image= line in $quadlet." >&2
  exit 1
fi

# Upstream's Dockerfile downloads the AWS RDS CA bundle and pins its checksum.
# When AWS republishes the bundle the pin breaks the build, so reuse the
# pinned bytes from the running image whenever they still match the pin.
dockerfile=packaging/oci/Dockerfile
pem=packaging/oci/aws-rds-global-bundle.pem
pinned=$(grep -o 'checksum=sha256:[0-9a-f]*' "$dockerfile" | cut -d: -f2)
container=$(podman create "$running")
podman cp "$container:/usr/local/share/ca-certificates/aws-rds-global-bundle.pem" "$pem"
podman rm "$container" >/dev/null
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

podman build -f "$dockerfile" \
  --build-arg IMAGE_REVISION="$revision" \
  --build-arg IMAGE_VERSION="$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')-3cxo" \
  -t "$tag" . </dev/null

backup="/srv/backups/artifact-server/pre-deploy-$(date +%Y%m%d-%H%M%S)"
/usr/local/sbin/artifact-server-backup "$backup"
# Keep the five newest pre-deploy backups.
find /srv/backups/artifact-server -maxdepth 1 -name 'pre-deploy-*' -type d \
  | sort | head -n -5 | xargs -r rm -rf

stamp=$(date +%Y%m%d-%H%M%S)
saved="/opt/artifact-server/artifact-server.container.bak-$stamp"
cp -p "$quadlet" "$saved"
sed -i "s|^Image=.*|Image=$tag|" "$quadlet"
systemctl daemon-reload
printf 'Rollback: cp %s %s && systemctl daemon-reload && systemctl restart artifact-server\n' \
  "$saved" "$quadlet"
# Notify=healthy: restart returns once the new container passes its healthcheck.
systemctl restart artifact-server

# Keep the three newest artifact-server images (one is the running one) and
# drop dangling build layers.
podman images --sort created --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' \
  | awk -F'\t' '$2 ~ /\/artifact-server:/' | sort -r | cut -f2 | tail -n +4 \
  | xargs -r podman rmi >/dev/null || true
podman image prune -f >/dev/null
printf 'Running %s; backup at %s\n' "$tag" "$backup"

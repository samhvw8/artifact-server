---
okf_version: '0.2'
---

# Artifact Server fork (3cxo)

* [Getting started](getting-started.md) - what the fork changes, where it runs, and the git remotes.

# Features

* [Same-site published content](features/same-site-content.md) - opt-in flag that lets pages share the app's registrable domain.
* [Artifact short names](features/short-names.md) - `<name>.<content domain>` serving or redirecting to an artifact's current version.
* [Artifact share codes](features/share-codes.md) - a code that opens a private artifact's current version without an account.

# Deployment

* [Artifact Server on 3cxo](deployment/3cxo-host.md) - domains, containers, nginx, certificates, login, and backups.

# Playbooks

* [Deploy the fork to 3cxo](playbooks/deploy-to-3cxo.md) - build, back up, switch image, roll back.
* [Pull an upstream release](playbooks/sync-upstream.md) - merge upstream into `3cxo` and re-test.

# Decisions

* [Published pages on 3cxo.work only](decisions/single-domain.md) - why the domain check was patched instead of buying a domain.
* [Public short names serve in place](decisions/short-name-serving.md) - why private names redirect.

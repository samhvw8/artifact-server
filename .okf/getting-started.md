---
type: Reference
title: Getting started — Artifact Server fork (3cxo)
description: What this fork changes in plannotator/artifact-server, where it runs, and where to read next.
resource: https://github.com/samhvw8/artifact-server/tree/3cxo
tags: [getting-started, fork]
status: stable
generated: { by: claude-code/opus-5.5, at: '2026-10-01T07:10:00Z' }
sources:
  - id: upstream
    resource: https://github.com/plannotator/artifact-server
    title: plannotator/artifact-server (upstream)
  - id: fork-branch
    resource: https://github.com/samhvw8/artifact-server/tree/3cxo
    title: samhvw8/artifact-server, branch 3cxo
---

# Overview

This repository is a fork of [plannotator/artifact-server](https://github.com/plannotator/artifact-server)[^upstream],
a self-hosted server that stores published HTML and other files as immutable
versions with review comments. The fork lives on branch `3cxo` of
`samhvw8/artifact-server`[^fork-branch]; `main` stays a mirror of upstream.

It runs one private installation on the host `3cxo` for a single owner. Every
change is kept small and in new files where possible, so upstream releases
merge cleanly.

# What the fork adds

| Change | Concept |
|--------|---------|
| Published pages may share the app's own domain (`*.art.3cxo.work` next to `artifacts.3cxo.work`), opt-in | [/features/same-site-content.md](/features/same-site-content.md) |
| Artifact short names: `<name>.art.3cxo.work` | [/features/short-names.md](/features/short-names.md) |
| One-command build and rollout to 3cxo | [/playbooks/deploy-to-3cxo.md](/playbooks/deploy-to-3cxo.md) |

# Where it runs

The live installation, its domains, certificates, backups and login are in
[/deployment/3cxo-host.md](/deployment/3cxo-host.md).

# Remotes

| Remote | URL | Role |
|--------|-----|------|
| `origin` | `git@github.com:samhvw8/artifact-server.git` | The fork; push `3cxo` here |
| `upstream` | `https://github.com/plannotator/artifact-server.git` | Source of releases |

Pulling a new upstream release is [/playbooks/sync-upstream.md](/playbooks/sync-upstream.md).

# Decisions

- [/decisions/single-domain.md](/decisions/single-domain.md): why pages live on `3cxo.work` and not a separate domain.
- [/decisions/short-name-serving.md](/decisions/short-name-serving.md): why public names serve in place and private names redirect.

[^upstream]: plannotator/artifact-server (upstream)
[^fork-branch]: samhvw8/artifact-server, branch 3cxo

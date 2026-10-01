---
type: Feature
title: Artifact short names
description: A unique human-chosen label per artifact so <name>.<content domain> serves or redirects to its current version.
resource: src/application/artifact-short-names.ts
tags: [short-names, http, mcp, ui, fork-change]
status: stable
generated: { by: claude-code/opus-5.5, at: '2026-10-01T09:45:00Z' }
sources:
  - id: app
    resource: src/application/artifact-short-names.ts
    title: Name rules, suggestions, set/get/list/check operations
  - id: store
    resource: src/storage/sqlite-artifact-short-name-store.ts
    title: SQLite store (artifact_short_names table)
  - id: http
    resource: src/http/create-http-app.ts
    title: serveShortNameHost and /api/v1 short-name routes
  - id: mcp
    resource: src/mcp/artifact-mcp-server.ts
    title: artifact_set_short_name and artifact_short_names tools
  - id: ui
    resource: apps/web/src/review/review-app.tsx
    title: ShortNameInspector
  - id: tests
    resource: tests/http/artifact-short-names.test.ts
    title: Short-name HTTP tests
---

# Overview

Every version is served from its own random 36-hex subdomain, and private
login sessions are bound to that exact subdomain. A short name adds one stable,
memorable host per artifact, for example
`https://how-to-live-better.art.3cxo.work/`.[^app]

| Artifact access | What `<name>.<content domain>` does |
|-----------------|-------------------------------------|
| `public_link` | Serves the current version in place; the address keeps the name |
| `account_required` | 302 to the review page of the current version on the app origin |
| `account_required` with a [share code](/features/share-codes.md) | Asks for the code, then serves in place |

Why the two behave differently: [/decisions/short-name-serving.md](/decisions/short-name-serving.md).

# Name rules

- 3–32 characters: lowercase letters, digits, hyphens; starts and ends with a
  letter or digit. Input is trimmed and lowercased.
- Cannot start with `review-` (preview leases) or `live-` (linked files).
- At most 32 characters, so a name can never equal a 36-character version token.
- Unique across the installation, because all names share one content domain.
- One name per artifact. Renaming frees the old name immediately. Names held by
  deleted artifacts count as free.

An invalid or taken name changes nothing and returns up to three free
suggestions, built from the requested name (`hello-2` …) and a slug of the
artifact name (`Sổ tay HSK 2` → `so-tay-hsk-2`).

# Serving

`serveShortNameHost` runs first in the content-host middleware, for GET and
HEAD only, and only when the host label passes the name rules. Anything else
falls through to the normal version-token handling unchanged.[^http]

- Public: calls `serveVersionContent` with the current version's content
  token and **no** session cookie. Responses keep `public, no-cache,
  must-revalidate` and a content ETag, so a new version shows on the next load.
- Private: `302` with `Cache-Control: no-store` to
  `<ARTIFACT_SERVER_ORIGIN>/review?artifact=…&project=…&version=…&view=focus`.
  The `Location` is built only from the trusted origin and stored IDs.

Requires `ARTIFACT_SERVER_ORIGIN`; without it short-name hosts are not answered.

# HTTP API

| Method and path | Auth | Purpose |
|-----------------|------|---------|
| `GET /api/v1/artifacts/:id/short-name` | artifact read | `{shortName, url}` |
| `PUT /api/v1/artifacts/:id/short-name` | artifact management | Body `{shortName: string \| null}`; `null` clears. 409 `SHORT_NAME_TAKEN` or 422 `INVALID_SHORT_NAME` carry `error.suggestions` |
| `GET /api/v1/short-names?projectId=` | artifact listing | Names in a project with artifact and URL |
| `GET /api/v1/short-names/:name/availability?artifactId=` | artifact listing | `{available, message, shortName, suggestions}`; `artifactId` treats that artifact's own name as free |

Browser `PUT`s go through the same CSRF and same-origin checks as every
`/api/*` mutation. Installations without the store answer
`CAPABILITY_UNAVAILABLE`.

# MCP tools

| Tool | Input | Notes |
|------|-------|-------|
| `artifact_set_short_name` | `artifactId`, `projectId?`, `shortName` (string or null) | Returns `status`: `assigned`, `cleared`, `invalid`, `taken`, plus `url` and `suggestions` |
| `artifact_short_names` | `projectId?`, `check?`, `artifactId?` | Lists names in use; `check` adds an availability result |

Registered only when the store exists.[^mcp] Upstream tool-count tests were
raised from 33 to 35.

# Review UI

The Details inspector shows a **Short name** section between Tags and Danger
zone. Managers can set, rename or remove the name; availability is checked
while typing and free suggestions are clickable. The section hides itself when
the server answers `CAPABILITY_UNAVAILABLE`.[^ui]

# Storage

```sql
CREATE TABLE IF NOT EXISTS artifact_short_names (
  short_name TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL UNIQUE REFERENCES artifacts(id),
  assigned_at TEXT NOT NULL
) STRICT;
```

Created by `SqliteArtifactShortNameStore` in the compact database
`artifact-server.db`. `assign` runs in `BEGIN IMMEDIATE`. Only the compact and
local runtimes wire the store; the Postgres and Cloudflare runtimes do not have
the feature.[^store]

# Known trade-offs

- A private name's redirect exposes the project, artifact and version IDs to
  anyone who tries the name. The IDs do not grant access.
- A freed name can be claimed by another artifact, so old shared links then
  open the new artifact.
- No test yet for a non-manager principal (403) or a CSRF-rejected `PUT`.

# Tests

`tests/http/artifact-short-names.test.ts` (7 tests)[^tests] and the short-name
calls in `tests/conformance/mcp-modern-http.test.ts`.

[^app]: Name rules, suggestions, set/get/list/check operations
[^http]: serveShortNameHost and /api/v1 short-name routes
[^mcp]: artifact_set_short_name and artifact_short_names tools
[^ui]: ShortNameInspector
[^store]: SQLite store (artifact_short_names table)
[^tests]: Short-name HTTP tests

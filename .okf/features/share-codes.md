---
type: Feature
title: Artifact share codes
description: A code that lets someone without an account open the current version of one private artifact.
resource: src/application/artifact-share-codes.ts
tags: [share-codes, access, http, mcp, ui, fork-change]
status: stable
generated: { by: claude-code/opus-5.5, at: '2026-10-01T09:45:00Z' }
sources:
  - id: app
    resource: src/application/artifact-share-codes.ts
    title: Code rules, generation, grant cookies, attempt limiter, set/get operations
  - id: store
    resource: src/storage/sqlite-artifact-share-code-store.ts
    title: SQLite store (artifact_share_codes table and drop-on-public trigger)
  - id: http
    resource: src/http/create-http-app.ts
    title: serveShareCodeContent, code page, /api/v1 share-code routes, /artifacts/:id forward
  - id: access
    resource: src/application/content-access.ts
    title: ContentAccessService.authorizeSharedContent
  - id: mcp
    resource: src/mcp/artifact-mcp-server.ts
    title: artifact_share_code tool
  - id: ui
    resource: apps/web/src/review/review-share.tsx
    title: Share popover "Share code" access option
  - id: tests
    resource: tests/http/artifact-share-codes.test.ts
    title: Share-code HTTP tests
---

# Overview

A third way to share, between **Private** and **Public link**. The artifact stays
`account_required`; a share code is added on top. Anyone with the link *and* the
code can open the **current version** without signing in. Earlier versions,
history, comments and the review page still need an account.[^app]

| Share popover option | Stored state |
|----------------------|--------------|
| Private | `account_required`, no code |
| Share code | `account_required` + a row in `artifact_share_codes` |
| Public link | `public_link` (any code is dropped) |

# Codes

- **Generated:** 8 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0/O/1/I/L),
  about 39 bits, shown as `K7QM-3XPA`.
- **Custom:** 6–32 letters or digits. Case, spaces and hyphens are ignored, so
  `my-code 2026` is stored as `MYCODE2026` and shown as `MYCO-DE20-26`.
- Stored in plain text, because the owner must be able to see and copy it again.
  It grants read access to one artifact only, so anyone with the database
  already has more than the code gives.
- Only one code per artifact. A new code (generated or custom) replaces the old one.

# Viewer flow

Content hosts answer share codes for GET and HEAD only.[^http]

1. A link with `?share_code=CODE`, or the code page's form (a GET form that
   uses the same parameter), is checked against the stored code.
2. Right code: `303` to the same path without the parameter, plus a grant
   cookie. Wrong code: the code page again with an error (`401`).
3. A request carrying a valid grant is served through
   `ContentAccessService.authorizeSharedContent`, which only allows the
   artifact's current version while the artifact is `account_required`.[^access]
   The response is `private, no-store`.
4. A page navigation without a grant gets the code page (`401`). Subresource
   requests without a grant, and members who have a content session, get the
   normal private handling.

Where it works:

| Entry | Behavior |
|-------|----------|
| `<short name>.<content domain>` | Code page (with a "Sign in instead" link to review), then served in place. Stable across versions |
| `<current version token>.<content domain>` | Code page, then served |
| `<app origin>/artifacts/:id[?share_code=]` | `302` to the current version host, passing the code through |

The share link handed out is the short-name host when the artifact has one,
otherwise `/artifacts/:id`. Without a short name, viewers land on a version
host, so after a new version is published they enter the code once more.

# Grant cookie

`__Host-artifact_share` (`artifact_share` on `*.localhost`), `HttpOnly`,
`Secure`, `SameSite=Lax`, 7 days. The value is
`<expiry>.<HMAC-SHA256(salt, artifactId, host, expiry, code)>`, so it is stateless
and works only for that artifact on that host. `Lax`, not `Strict`, because
links arrive from other sites (chat, mail) and the redirect after a code entry
must carry the cookie.

Each code change writes a new random `salt`. That revokes every grant at once;
clearing the code does too.

# Guessing limits

`ShareCodeAttemptLimiter` keeps wrong guesses in memory for 15 minutes: 10 per
artifact and client, and 100 per artifact overall. A blocked client gets `429`
even with the right code. The client is the **last** `X-Forwarded-For` entry,
the one nginx appends. The limiter resets on restart.

# HTTP API

| Method and path | Auth | Purpose |
|-----------------|------|---------|
| `GET /api/v1/artifacts/:id/share-code` | artifact management | `{shareCode, url, urlWithCode}`; nulls when none or when the artifact is public |
| `POST /api/v1/artifacts/:id/share-code` | artifact management | Generate a new code |
| `PUT /api/v1/artifacts/:id/share-code` | artifact management | Body `{shareCode: string \| null}`; `null` clears. `422 INVALID_SHARE_CODE`, `409 SHARE_CODE_REQUIRES_PRIVATE` |

Reading the code needs management rights because the code is itself a
credential. Installations without the store answer `CAPABILITY_UNAVAILABLE`.

# MCP tool

`artifact_share_code` takes `artifactId`, `projectId?`, `action` (`generate`,
`set`, `get`, `clear`) and `shareCode` for `set`. It returns `status`,
`shareCode`, `url` and `urlWithCode`.[^mcp] It is registered only when the store
exists. The upstream tool-count tests were raised from 35 to 36.

# Review UI

Share → Manage access shows **Share code** between Private and Public link. The
option appears only when the code can be read (capability on, and the viewer
manages artifacts). Choosing it makes a public artifact private first, then
generates a code, or uses the one typed in. While a code is active, the
overview lists **Share code** and **Link with code** under Other links, and the
access editor offers **New code**.[^ui]

# Storage

```sql
CREATE TABLE IF NOT EXISTS artifact_share_codes (
  artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id),
  code TEXT NOT NULL,
  salt TEXT NOT NULL,
  set_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER IF NOT EXISTS artifact_share_codes_drop_on_public
AFTER UPDATE OF access_setting ON artifacts
WHEN NEW.access_setting <> 'account_required'
BEGIN DELETE FROM artifact_share_codes WHERE artifact_id = NEW.id; END;
```

The trigger drops the code however the artifact becomes public (HTTP, MCP or
CLI), so an old code cannot come back if the artifact is made private again.
Lookups ignore deleted artifacts. As with short names, only the compact and
local runtimes have the store.[^store]

# Known trade-offs

- Codes appear in nginx access logs when sent as `?share_code=`.
- The guess limiter is per process and in memory.
- The public-links admin inventory does not list share-code artifacts.

# Tests

`tests/http/artifact-share-codes.test.ts` (7 tests)[^tests], the
`artifact_share_code` calls in `tests/conformance/mcp-modern-http.test.ts`, and
the Share code step in `tests/browser/frontend-mvp.spec.ts` (CMT-017).

Related: [/features/short-names.md](/features/short-names.md).

[^app]: Code rules, generation, grant cookies, attempt limiter, set/get operations
[^http]: serveShareCodeContent, code page, /api/v1 share-code routes, /artifacts/:id forward
[^access]: ContentAccessService.authorizeSharedContent
[^mcp]: artifact_share_code tool
[^ui]: Share popover "Share code" access option
[^store]: SQLite store (artifact_share_codes table and drop-on-public trigger)
[^tests]: Share-code HTTP tests

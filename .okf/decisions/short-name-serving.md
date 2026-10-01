---
type: Decision
title: Public short names serve in place, private ones redirect
description: Why a short-name host serves a public artifact directly but redirects a private one to its review page.
tags: [decision, short-names, security]
status: stable
generated: { by: claude-code/opus-5.5, at: '2026-10-01T07:10:00Z' }
---

# Context

The owner wanted `how-to-live-better.art.3cxo.work` to stay in the address
bar instead of jumping to the long version subdomain.

Upstream binds private content sessions to one exact version origin: a
one-time bootstrap is exchanged for a host-only cookie on
`<36-hex token>.<content domain>`. A stable name host would need its own
session scheme, a much larger change to security code that would also have to
be re-merged on every upstream release.

# Decision

| Artifact access | Short-name host |
|-----------------|-----------------|
| `public_link` | Serves the current version in place. Needs no session, so nothing in the session code changes |
| `account_required` | Redirects to the review page of the current version |

Started as redirect-only for both; changed to serve public artifacts in place
on 2026-10-01 at the owner's request.

# Consequences

- Public pages at a name keep upstream's `public, no-cache, must-revalidate`
  plus ETag, so a new version appears on the next load.
- Pages served at a name and at their version subdomain are different
  origins, so browser storage is not shared between them.
- Details: [/features/short-names.md](/features/short-names.md).

---
type: Feature
title: Browser session lifetime (configurable)
description: ARTIFACT_SERVER_SESSION_LIFETIME_HOURS sets how long a browser login lasts, instead of upstream's fixed 12 hours.
resource: src/lifecycle/runtime-configuration.ts
tags: [configuration, authentication, fork-change]
status: stable
generated: { by: claude-code/opus-5.5, at: '2026-10-10T10:30:00Z' }
sources:
  - id: runtime-config
    resource: src/lifecycle/runtime-configuration.ts
    title: parseSessionLifetime
  - id: installation-access
    resource: src/application/installation-access.ts
    title: issueSession
---

# Overview

Upstream issues every browser login session for a fixed 12 hours. After that,
the review app gets a 401 and sends the user back through the identity
provider (Pocket ID on 3cxo). This fork makes the lifetime a setting for the
compact runtime.[^runtime-config]

Sessions stay absolute: using one does not extend it. The session cookie's
`Expires` follows the session's `expiresAt`.[^installation-access]

# Configuration

| Variable | Values | Default | Effect |
|----------|--------|---------|--------|
| `ARTIFACT_SERVER_SESSION_LIFETIME_HOURS` | integer 1–8760, or empty | 12 | Lifetime of each new browser login session |

Any other value fails startup with `invalid_value` on the variable. A change
applies only to sessions issued after the restart.

`packaging/compose/compose.yaml` passes the variable through to the container.
The external-storage runtime does not read it and keeps 12 hours.

# Risk accepted

A stolen session cookie stays valid for the whole lifetime. Logout and
revocation still end a session at once.

# Tests

- `tests/cli/lifecycle-cli.test.ts`: default, 720 hours, and invalid values.
- `tests/conformance/installation-identity.test.ts`: a 30-day session is still
  valid after 13 hours and is refused after 30 days.

Related: [Artifact Server on 3cxo](/deployment/3cxo-host.md).

[^runtime-config]: parseSessionLifetime
[^installation-access]: issueSession

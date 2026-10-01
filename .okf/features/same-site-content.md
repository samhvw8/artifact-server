---
type: Feature
title: Same-site published content (opt-in)
description: ARTIFACT_SERVER_ALLOW_SAME_SITE_CONTENT lets the content domain share a registrable domain with the application origin.
resource: src/lifecycle/runtime-configuration.ts
tags: [configuration, security, fork-change]
status: stable
generated: { by: claude-code/opus-5.5, at: '2026-10-01T07:10:00Z' }
sources:
  - id: runtime-config
    resource: src/lifecycle/runtime-configuration.ts
    title: assertBrowserIsolation and parseAllowSameSiteContent
  - id: csrf
    resource: src/http/create-http-app.ts
    title: requireBrowserMutationSecurity
  - id: commit
    resource: https://github.com/samhvw8/artifact-server/commit/d956d0f
    title: Allow published content on the application's own domain (opt-in)
---

# Overview

Upstream refuses to start when the application origin and the published
content domain share a registrable domain, so that agent-written HTML cannot
set cookies on the app's parent domain. This fork adds an opt-in escape for
installations that can only use one domain.[^runtime-config]

# Configuration

| Variable | Values | Default | Effect |
|----------|--------|---------|--------|
| `ARTIFACT_SERVER_ALLOW_SAME_SITE_CONTENT` | `true`, `false`, empty | off | `true` skips the separate-registrable-domain check |

With the flag on, startup still fails when:

- either domain has no registrable domain (`tldts.getDomain` returns null), or
- the application host equals the content domain or sits inside it
  (`artifacts.art.example.com` with content domain `art.example.com`), which
  would make the app host a content host.

Any other value than `true`, `false` or empty fails with
`invalid_value` on `ARTIFACT_SERVER_ALLOW_SAME_SITE_CONTENT`.

`packaging/compose/compose.yaml` passes the variable through to the container.

# Risk accepted

Published pages can set cookies for the parent domain (`.3cxo.work`), which
reach every sibling host, including the Pocket ID login at `id.3cxo.work`.

What still holds:

- Application session and CSRF cookies are `__Host-` prefixed, which a
  subdomain cannot set.
- Browser mutations require an exact `Origin` match, `Sec-Fetch-Site:
  same-origin`, and a CSRF token.[^csrf]

# Tests

`tests/cli/lifecycle-cli.test.ts` covers the accepted case, an app host
inside the content domain, and an invalid flag value.

See [/decisions/single-domain.md](/decisions/single-domain.md) for why this was chosen.

[^runtime-config]: assertBrowserIsolation and parseAllowSameSiteContent
[^csrf]: requireBrowserMutationSecurity

---
type: Feature
title: Direct version links open through the sign-in session
description: A page load on a private version host without a content session bounces through the app origin, which issues the same one-time bootstrap Review would, or asks the visitor to sign in first.
resource: src/http/create-http-app.ts
tags: [access, http, content-sessions, fork-change]
status: stable
generated: { by: claude-code/opus-5.5, at: '2026-10-23T15:30:00Z' }
sources:
  - id: http
    resource: src/http/create-http-app.ts
    title: contentOpenBounce and the GET /content/open route
  - id: access
    resource: src/application/content-access.ts
    title: ContentAccessService.issueContentBootstrapForToken
  - id: tests
    resource: tests/http/content-open.test.ts
    title: Direct version link tests
---

# Overview

Each version is served from its own host (`<36-hex token>.<content domain>`).
A private version, and any version that is not the current one of a public
artifact, needs a `__Host-artifact_content` cookie for that exact host. Upstream
creates that cookie only from Review, and it lasts 15 minutes. So a version link
opened in a new tab, from chat or from a bookmark answered
`401 CONTENT_NOT_PUBLIC` as JSON, even for a signed-in member.

The content host cannot read the application session cookie, which is
`__Host-` and bound to the app origin. This fork bounces the page load through
the app origin instead.[^http]

# Flow

1. **Version host.** A request that fails with `ContentSessionRequired` gets a
   `302` to `<ARTIFACT_SERVER_ORIGIN>/content/open?path=<path>&token=<token>`
   only when all of these hold: `GET`, `Sec-Fetch-Mode: navigate`,
   `Sec-Fetch-Dest: document`, `Sec-Fetch-Site` is not `same-origin`, and an
   application origin is configured. Everything else keeps the plain `401`.
2. **`GET /content/open`** on the app origin:
   - No valid application session: `302` to
     `/auth/login?returnTo=/content/open?...` (OIDC returns the visitor to the
     same request), or to `/` on a local-owner installation.
   - Signed in: `issueContentBootstrapForToken` finds the version by its token
     and calls `issueContentBootstrap` with the same project and artifact checks
     Review uses.[^access] Then `302` to the version host's
     `?__artifact_bootstrap=` URL, keeping the deep path.
   - Unknown token: `404`. No access: the usual `403`. No redirect in either case.
3. **Bootstrap exchange** (upstream, unchanged) sets the cookie and refreshes to
   the path.

# Why `same-origin` does not bounce

The exchange page's refresh is a same-origin navigation. If the browser refuses
the cookie, bouncing it would reload forever; instead it shows the `401`. The
cost: after 15 minutes, a link *inside* a multi-page artifact shows the `401`.
Reloading the page (a `Sec-Fetch-Site: none` navigation) bounces and recovers.

# Security

- A hostile site can send a visitor to `/content/open`. The visitor then sees
  their own content in their own browser; nothing reaches the other site.
- The bootstrap token is single-use, lasts 2 minutes, and travels in a URL as it
  already does from Review. Responses carry `Referrer-Policy: no-referrer`.
- `returnTo` goes through the existing `safeReturnTo` (same-origin paths only).
- Cookie isolation per version host is unchanged.

# Effect on 3cxo

On 2026-10-23, 102 of 116 live version hosts needed a content session
(24 private current, 37 private old, 41 old versions of public artifacts).
All of them now open from a direct link for a signed-in member. An anonymous
visitor to an old public version now gets the sign-in page instead of JSON.

# Tests

`tests/http/content-open.test.ts` (7 tests): the bounce, the cases that keep the
`401` (plain fetch, script, same-origin, iframe, HEAD), the full member flow,
an old version and a deep path, the local-owner sign-in redirect, refused tokens,
and a private-team installation that signs in through OIDC and returns to the
same `/content/open` request.[^tests] Five of them fail without the change.

One existing assertion changed with it: in `tests/http/artifact-share-codes.test.ts`,
a page load after the share code is cleared now expects the bounce to
`/content/open`, not a JSON `401`.

Related: [/features/short-names.md](/features/short-names.md),
[/features/share-codes.md](/features/share-codes.md).

[^http]: contentOpenBounce and the GET /content/open route
[^access]: ContentAccessService.issueContentBootstrapForToken
[^tests]: Direct version link tests

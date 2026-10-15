---
type: Feature
title: Review opens HTML in interact mode
description: The review page starts HTML artifacts in interact mode, so sliders, buttons and links work on first load; annotate mode is one click away.
resource: apps/web/src/review/review-app.tsx
tags: [review, frontend, fork-change]
status: stable
generated: { by: claude-code/opus-5.5, at: '2026-10-15T11:10:00Z' }
sources:
  - id: review-app
    resource: apps/web/src/review/review-app.tsx
    title: ArtifactReview htmlAnnotateModeActive state
  - id: browser-test
    resource: tests/browser/frontend-mvp.spec.ts
    title: CMT-015 review application test
---

# Overview

Upstream starts every HTML preview in **annotate mode**: a click on the page
opens a comment instead of pressing the control. Interactive artifacts
(simulations, tools, games) then look broken until the reviewer finds the
toggle. This fork starts in **interact mode** instead.[^review-app]

| Mode | Clicks do | How to enter |
|------|-----------|--------------|
| Interact (default) | Work normally on the page; selecting text still offers a comment | Page load, or Escape while annotating |
| Annotate | Pin a comment to the clicked element | The "Interact mode" button in the header or full-screen toolbar |

Escape still leaves annotate mode first. In interact mode, Escape exits
full screen, as before.

# Change

One line: `useState(true)` → `useState(false)` for `htmlAnnotateModeActive`.
There is no setting or URL parameter; the mode is not remembered between page
loads.

# Tests

`tests/browser/frontend-mvp.spec.ts` (CMT-015) checks that HTML opens in
interact mode, a native control click works without opening a comment, the
toggle turns annotating on, and Escape turns it off.[^browser-test]

# Sync risk

A future upstream pull that touches this state line will conflict. Keep
`false` and the test expectations above. See
[Pull an upstream release](/playbooks/sync-upstream.md).

[^review-app]: ArtifactReview htmlAnnotateModeActive state
[^browser-test]: CMT-015 review application test

---
type: Decision
title: Published pages on 3cxo.work only
description: Content moved from *.art.voxtract.app to *.art.3cxo.work by patching the domain check instead of buying a separate domain.
tags: [decision, domains, security]
status: stable
generated: { by: claude-code/opus-5.5, at: '2026-10-01T07:10:00Z' }
---

# Context

Upstream requires published content on a different registrable domain from
the app. The owner's Cloudflare account had two zones: `3cxo.work` and
`voxtract.app`. The original setup put content on `*.art.voxtract.app`, but
`voxtract.app` belongs to another product.

# Options considered

| Option | Cost to run | Outcome |
|--------|-------------|---------|
| Buy a separate domain (`3cxo.dev` $8.20 then $12.20/yr; `3cxo.works` $30.20/yr) | Small yearly fee, no fork | Rejected by the owner |
| Swap: app on `voxtract.app`, pages on `3cxo.work` | No fork, ties `voxtract.app` further in | Rejected |
| Patch the check behind an opt-in flag, keep everything on `3cxo.work` | Fork to maintain; pages can set `.3cxo.work` cookies | **Chosen** |

# Decision

Keep everything on `3cxo.work` with
[same-site content](/features/same-site-content.md) turned on, accepting the
cookie risk for sibling hosts. Only the owner's own agents publish, which keeps
the practical risk low.

# Consequences

- The fork must be rebuilt for every upstream release; see
  [/playbooks/sync-upstream.md](/playbooks/sync-upstream.md).
- Revisit if anyone other than the owner gets publish rights.

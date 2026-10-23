# Update Log

## 2026-10-15
* **Creation**: [Review opens in interact mode](/features/review-interact-default.md) — HTML previews start in interact mode instead of annotate mode.

## 2026-10-10
* **Creation**: [Browser session lifetime](/features/session-lifetime.md) — `ARTIFACT_SERVER_SESSION_LIFETIME_HOURS`, set to 720 on 3cxo.
* **Update**: [Artifact Server on 3cxo](/deployment/3cxo-host.md) and [Pull an upstream release](/playbooks/sync-upstream.md) list the new setting.

## 2026-10-03
* **Update**: [Data slots](/features/data-slots.md) — rebuilt on Turso sync (owner's decision; owner maintains fixes). The earlier design moved to [Data slots fallback](/features/data-slots-fallback.md).
* **Update**: [Data slots](/features/data-slots.md) — replaced the Mac launchd jobs with an on-demand `gym-data` skill.
* **Update**: [Data slots](/features/data-slots.md) — added the `_journal` history table, notes and comments tables, and an owner-only read-only SQL query endpoint.
* **Creation**: [Data slots](/features/data-slots.md) — draft architecture for page data, before any code.

## 2026-10-01
* **Creation**: [Artifact share codes](/features/share-codes.md) — private artifacts opened without an account by code.
* **Update**: [Artifact short names](/features/short-names.md) and [Getting started](/getting-started.md) link the new feature.
* **Creation**: bundle for the 3cxo fork — [Getting started](/getting-started.md).
* **Creation**: features — [Same-site published content](/features/same-site-content.md), [Artifact short names](/features/short-names.md).
* **Creation**: live installation — [Artifact Server on 3cxo](/deployment/3cxo-host.md).
* **Creation**: playbooks — [Deploy the fork to 3cxo](/playbooks/deploy-to-3cxo.md), [Pull an upstream release](/playbooks/sync-upstream.md).
* **Creation**: decisions — [Published pages on 3cxo.work only](/decisions/single-domain.md), [Public short names serve in place](/decisions/short-name-serving.md).

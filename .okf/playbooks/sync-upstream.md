---
type: Playbook
title: Pull an upstream release into the fork
description: Merge a new plannotator/artifact-server release into branch 3cxo, re-test, and deploy.
tags: [playbook, upstream, fork]
status: draft
generated: { by: claude-code/opus-5.5, at: '2026-10-01T07:10:00Z' }
---

# Trigger

A new release on `plannotator/artifact-server`.

# Steps

1. `git fetch upstream && git checkout main && git merge --ff-only upstream/main && git push origin main`
2. `git checkout 3cxo && git merge main`
3. Resolve conflicts. The fork touches these upstream files; everything else
   is in new files:

   | File | Fork change |
   |------|-------------|
   | `src/lifecycle/runtime-configuration.ts` | [same-site content](/features/same-site-content.md) |
   | `src/http/create-http-app.ts` | short-name host handling and routes |
   | `src/mcp/artifact-mcp-server.ts`, `src/mcp/create-mcp-http-adapter.ts` | short-name tools and wiring |
   | `src/local/create-local-runtime.ts` | short-name store wiring |
   | `src/core/errors.ts` | `shortName` repository operation |
   | `apps/web/src/review/review-app.tsx`, `apps/web/src/api/client.ts`, `apps/web/src/review/review.css` | Short name UI |
   | `packaging/compose/compose.yaml` | `ARTIFACT_SERVER_ALLOW_SAME_SITE_CONTENT` passthrough |
   | `tests/cli/mcp-onboarding.test.ts`, `tests/conformance/mcp-modern-http.test.ts` | tool count 35 and short-name calls |

4. If upstream added MCP tools, the tool-count assertions become upstream
   count + 2.
5. `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test`
6. `git push origin 3cxo`, then [deploy](/playbooks/deploy-to-3cxo.md).

This playbook has not been run yet; mark it `stable` after the first sync.

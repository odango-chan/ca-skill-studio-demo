# Skill Studio · L2-D4a Browser Worker terminal-failure degradation

**Scope:** Browser-Only Theia / actual Chromium. Demonstrate a real dedicated Language Worker termination, visible fail-closed LSP state, and continued native YAML/Python text editing. Do not claim Worker restart, Package switching, desktop/Node LSP, or Runtime authority.

## Fault containment

- Browser LanguageClient listens for the Worker `error` / `messageerror` events, VS Code LSP connection error/closed handlers and unexpected stopped state. The transport error is terminal for that client; explicitly disable SDK automatic restart.
- The host presents `SKILL LSP: UNAVAILABLE`, preserving the original failure reason in status tooltip and Language Service Output. Subsequent Package refresh events must not replace that terminal state with `ANALYZING` or stale `READY`.
- Native source editing, Inspector and Package Audit remain outside the Worker; failure must not authorize Source writes or promote old LSP evidence.
- No uncontrolled retry loop or cross-transport fallback.

## Real Chromium acceptance

1. Complete all pre-existing live editor-provider, Problems, unsaved cross-file, Inspector, Verify Step, Undo, Route and layout/reload gates **before** Worker fault injection.
2. Use Chrome DevTools Protocol `Target.getTargets` and `Target.closeTarget` to close the *actual nested Language Worker* (`skill-language-server.js`), not the Theia host, an LSP mock, or an internal fabricated error notification.
3. Assert `SKILL LSP: UNAVAILABLE` replaces old READY, with a bounded observational wait. A missing CDP worker target is a failure with target inventory, not a skip.
4. Through real VS Code `TextDocument` and `WorkspaceEdit`, open the Package Python script, modify its unsaved text and prove its persistent Source bytes stayed unchanged. Restore original bytes, native clean buffer, and Procedure editor focus.
5. Record `STUDIO_LSP_WORKER_TARGETS_CHROMIUM` and `STUDIO_LSP_WORKER_DEGRADED_CHROMIUM`; require the ordinary four CI workflows at exact head.

This slice does not claim recovery to READY, automatic Worker recreation, or clearing every prior LSP diagnostic on abrupt termination. Those must be separately verified before general fault-recovery acceptance. The Worker and Language Core remain read-only; the test harness owns temporary Source modifications.

## Delivery

Draft stacked on L2-D3a (#117); no merge to main, no Pages deployment, no Runtime or 5GC operations. Exact-head real Chromium PASS is mandatory.

## First Chromium integration failure (pre-fault)

The first exact-head run did not reach fault injection: the existing D1 editor feature acceptance waited on a current Package generation that returned `PARTIAL`, despite a structurally complete snapshot and no published diagnostics. This remains a failure, not an accepted degraded result. The new diagnostic-only status fields report the exact generation's Procedure projection state, Procedure diagnostic count, Package Audit state and unavailability reason, and the host tooltip surfaces them when `PARTIAL`. Follow-up must establish whether source/undo left an actually invalid graph or analysis misclassified a valid Package, rather than adding sleeps or accepting stale READY.

## Pre-fault Package read race and bounded recovery

The Chromium failure was traced to a transient `EntryNotFound / ENOENT` reading `schemas/selection.schema.yaml` **after** file enumeration: current Procedure projection was READY while Package Audit was UNAVAILABLE. A later fresh snapshot could read the same file. Merely waiting longer for READY cannot resolve a generation already published as PARTIAL.

The host now preserves that PARTIAL result and retries **only** when its actual sent snapshot reports a workspace `Unable to read file` with `EntryNotFound` / `ENOENT`; maximum three subsequent snapshots, each with its own monotonically increasing Package generation and stale-result invalidation. External Source changes reset the bounded attempt count; a persistent failure remains PARTIAL rather than being silently accepted. No fixed sleep is used as a readiness oracle, no Source write or Package Audit ownership changes.

Status diagnostics distinguish the exact dispatched snapshot completeness from a later recollection and expose same-generation Procedure / Audit state on PARTIAL. This is an L2-D4 integration blocker correction, not proof of successful Worker failure acceptance by itself.

## Chromium Worker identity discovery

The first run that reached the fault gate revealed four dedicated-worker CDP targets with empty `TargetInfo.url` values. Treating any one of those targets as the Language Worker would risk killing the browser extension host instead. The Chromium acceptance now opens a flattened CDP session for each dedicated Worker, reads `WorkerGlobalScope.name` and `self.location.href`, detaches, and selects only the exact `skill-studio-language-server` identity or the bundled `skill-language-server.js` script. Unknown targets are never terminated. `Target.closeTarget` is issued only after this identity proof.

---
name: establish-pdu-session
description: CA-SL v1alpha4 illustrative Open5GS / UE-requested initial PDU Session establishment source.
---

# Establish PDU Session — 5GC

**Source language:** CA-SL v1alpha4 (pinned normative specification `7f84393ee8c395e4d8c39a74cb5000a1f896588d`).

**Adoption state: NOT_QUALIFIED.** This is an authoring and editor example, **not** a linked, executable or approved 5GC Skill. Its `urn:example:` dependency identities and evidence guarantees are illustration-only; there is no trusted v1alpha4 ToolCatalog or CapabilityContracts publication in this repository. The Compiler **must fail closed** when those exports or their exact version/trust bindings are absent.

## Scope and business progression

One admitted, initial IPv4 / SSC1, local non-roaming PDU Session request. Never substitute an arbitrary UE, PSI, lifecycle, resource or late callback; identity and Scope require independent Host/Owner proof.

Conventional 5GC progression is UDM SM-data retrieval, UDM SDM Subscribe, PCF SM Policy Create, prepared N1/N2 transfer, authoritative RAN and N4 convergence, and durable resource responsibility. The old complete 5GC business Case catalog is retained in `examples/legacy/establish-pdu-session/cases/` for migration review, not imported as v1alpha4 test fixtures.

## Runtime and evidence boundary

Every Mutation `OUTCOME_UNKNOWN` goes to an explicit safe stop. An Owner-published `mutation.reconcile` can be used **only through the Host common safety boundary**, not an authored `reconcile` Node. The only successful Invocation edge is `verify-final.postcondition.routes.PASS: SUCCEEDED`, where all listed predicates must pass with authoritative, fresh, same-lifecycle Evidence.

**Known blockers:** missing exact v1alpha4 Owner/Capability publications, checked output Schemas and Evidence descriptors, confirmed callable input identities, and Compiler/Studio/Host §45.2 execution evidence. Do **not** infer completion or production readiness from YAML syntax checks.

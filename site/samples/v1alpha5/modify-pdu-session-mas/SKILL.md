---
name: modify-pdu-session-mas
description: CA-SL v1alpha5 Modify Procedure for the merged OpenAMSM Scheme C Owner transaction.
---

# Modify PDU Session - OpenAMSM Scheme C MAS profile

**Source language:** CA-SL v1alpha5.

**Adoption state: OWNER_LINKED / DEVELOPMENT_STATIC_BUILD_PASS / PRODUCTION_NOT_QUALIFIED.** The `mas` dependency resolves to the published Owner package `urn:openamsm:mas:tool-contracts` v1alpha4. Its ToolCatalog, Scheme C callable input/output Schemas, mutation receipt and commit-proof Schemas, Evidence Guarantees, Owner identity and deployment CapabilityContracts are published. `ca-skills` PR #85 verified this Skill with released `skillc v2.0.2` in release mode against the Owner v1alpha4 publication, without a fixture Owner identity. This is static Compiler evidence only: it is not Production Admission, and the 2026-11-23 live Development E2E used the pre-PR #85 source revision. Re-run the live E2E against this exact Owner-linked revision before claiming current-source E2E.

## Scope

This Skill models a UE-requested QoS modification of an already admitted PDU
Session. The Host authenticates and classifies the ingress, retains the exact
original 5GSM PDU Session Modification Request (0xc9) and binds the exact
SUPI / PSI / current session generation. The Owner - not the Skill and not the
Host - decodes the requested QoS target.

The Skill does not parse NAS, does not derive or fabricate QoS values, does not
create an SM Context, and does not expose Host / Owner correlation handles. The
original binary payload and private session references stay inside the
responsible Host / Owner adapters.

## Entry variants

The Host constructs request.entryKind after authenticating and classifying the
business event:

- UE_INITIATED - a UE-originated modification delivered through Nsmf
  UpdateSMContext with N1 0xc9.
- AMF_INITIATED - an AMF-originated UpdateSMContext business action.
- NETWORK_TRIGGERED - a trusted internal event.

These variants converge on the same two Owner occurrences. This classification
belongs to the Host; it is not new CA-SL syntax.

An N2 Setup Response or N1/N2 Modify completion that completes an already
pending Owner occurrence is **not** a new entry variant and must not start this
Skill. It resumes the original Run for the same SUPI / PSI / generation.

## Source progression (merged Owner)

The Procedure contains exactly two Owner occurrences:

1. `c-parse` - `SSM.PARSE_N1_MODIFY` with `parse_n1=1`; the typed Provider
   supplies the exact retained N1 from trusted private context. Read-only: the
   Owner decodes exactly one requested QoS flow
   description and returns `qfi`, `five_qi`, `gfbr_ul`, `gfbr_dl`, `mfbr_ul`,
   `mfbr_dl` and `requested_kind=qos_flow_descriptions`. Any decode failure,
   non-0xc9, missing or multiple flow descriptions fails closed.
2. `c-apply` - `UPN.MODIFY_QOS_DELTA` with `qos_flows_delta=1` and the parsed
   target. The Owner validates the target against the authoritative flow,
   applies PFCP Session Modification 52/53 and dispatches N1 0xcb plus N2
   PDU_RES_MOD_REQ through the agent relay. It completes only after the relay's
   Namf Transfer is accepted and reports `qos_delta_state` and the applied
   target.

The older OES-shaped `SC.UPDATE_SM_CONTEXT` / `UPN.MODIFY_UP_SESSION_INTENT` /
`SSM.SIGNAL_UE_AN_MODIFY` / `UPN.MODIFY_QOS_FLOWS` sequence is **not** this
Owner transaction and is not used by this version.

## Owner boundary

The merged Owner performs the Modify transaction natively. The Host retains the
original N1 and the exact invocation scope; a business Nsmf Update is never
forwarded to the `agent_step` SMF as a second Modify authority. A later N2
Modify Response or N1 Modification Complete is a native continuation for the
same Owner transaction and is forwarded to the SMF by the Host.

Every Owner callable occurrence is a candidate MUTATION except the parse
occurrence, which is READ. The Owner must provide exact occurrence identity,
commit receipts, SUPI / PSI / generation scope binding and Evidence. A raw HTTP
response or a source marker is not proof of the current invocation.

See the [pinned operation mapping](references/openamsm-operation-mapping.md).

## Goal boundary

A successful Invocation proves that, for the same SUPI / PSI / generation, the
Owner decoded the exact retained N1 into one GBR target and the applied result
reports the exact same target field by field: `qfi`, `five_qi`, `gfbr_ul`,
`gfbr_dl`, `mfbr_ul`, `mfbr_dl`.

- `APPLIED` additionally requires `n1n2_dispatched == "1"` (PFCP QER accepted
  and the native N1/N2 Modify handed to the relay).
- `ALREADY` requires that no N1/N2 dispatch was reported; it is the Owner's
  authoritative exact-state comparison, not an independent observation.
- `PFCP_APPLIED_N1N2_FAILED`, a missing field, a different target or an unknown
  state cannot satisfy the Goal.

All values are canonical decimal strings under the Owner contract, so CEL string
equality is exact equality without implicit conversion or floating point.

**Completion scopes are distinct.** `APPLIED` is not RAN/UE acceptance:
`PFCP_APPLIED` and `N1N2_DISPATCHED` are Owner facts on this Operation;
`RAN_MODIFICATION_CONFIRMED` requires the separate N2 Modify Response and
`TARGET_STATE_VERIFIED` requires an independent Owner read. This Skill does not
prove live 5GC qualification or user-plane traffic success.

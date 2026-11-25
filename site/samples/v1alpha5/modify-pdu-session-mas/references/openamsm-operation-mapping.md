# Modify OpenAMSM Scheme C operation mapping

**Status: SOURCE-ALIGNED DESIGN / NOT_QUALIFIED / NOT_LINKABLE.** This mapping
describes the merged Owner Scheme C Modify transaction. It is not a published
Owner ToolCatalog, receipt or Runtime result.

## Pinned source

- Repository: odango-chan/env-openamsm
- Commit: 594dec78b95bff4fdc34deac8a3a9681fb41228f
- Historical plan: upstream/openamsm/tools/nw-agent/plans/modify/pdu-mod-v3.yaml
- Plan blob SHA: 8a2caf343c29bb64cbb09b29994c79ac8ad5da05
- Implementation: src/smf/mas/ssm/ssm_ue.c, src/smf/mas/upn/upnode.c

The pinned OES plan is historical provenance only. Its declared
`SC.UPDATE_SM_CONTEXT` / `UPN.MODIFY_UP_SESSION_INTENT` /
`SSM.SIGNAL_UE_AN_MODIFY` / `UPN.MODIFY_QOS_FLOWS` sequence is superseded by the
merged Owner transaction and is not the execution order this Skill implements.

## Procedure mapping

| CA-SL node | Owner callable | Effect | Inputs | Declared Owner outputs |
| --- | --- | --- | --- | --- |
| `validate-modify-request` | none (Predicate) | - | `supi`, `pduSessionId`, `entryKind` | - |
| `parse-n1` | `SSM.PARSE_N1_MODIFY` | READ | `ue_identity`, `psi`, `parse_n1=1`; exact retained 0xc9 N1 from trusted private context | `qfi`, `five_qi`, `gfbr_ul`, `gfbr_dl`, `mfbr_ul`, `mfbr_dl`, `requested_kind=qos_flow_descriptions` |
| `apply-qos-delta` | `UPN.MODIFY_QOS_DELTA` | MUTATION | `ue_identity`, `psi`, `qos_flows_delta=1`, plus the parsed target | `qos_delta_state`, `n1n2_dispatched` (APPLIED only), applied target |
| `verify-modify-completion` | none (Postcondition) | - | `parse-n1` output, `apply-qos-delta` output | - |

The raw N1 stays in trusted private context and is resolved by the typed
Provider; it is not a Skill-authored request field. `ue_identity` and `psi` bind
exact Owner Scope. The parsed target is Provider-injected from `parse-n1`, never
taken from an AMF JSON body and never exposed as `qosFlowsDelta` in the request
Schema.

## Read-only parse

`parse-n1` is READ: it decodes exactly one requested GBR flow description and
returns the typed target. The parse must not mutate session state, must not bind
the PTI, and fails closed on a non-0xc9 message, a decode failure, a missing flow
or multiple flow descriptions. It emits no commit receipt.

## Completion semantics

| Output | Meaning |
| --- | --- |
| `qos_delta_state=APPLIED` | The PFCP Update QER was accepted and the native N1/N2 Modify was dispatched. |
| `qos_delta_state=ALREADY` | The authoritative flow already equals the exact parsed target; no PFCP was sent and no N1/N2 was dispatched. |
| `n1n2_dispatched=1` | Present only for APPLIED; the relay send was checked. |
| `qfi`, `five_qi`, `gfbr_*`, `mfbr_*` | The applied target after the transaction, as canonical decimal strings. |

The Postcondition compares every one of those target fields with the **parsed**
Owner target. The Owner contract reports canonical decimal strings (base-10, no
sign, no leading zero), so equality is exact without implicit conversion,
floating point or precision loss. CA-SL v1alpha5 does not accept `pattern` in a
Skill-owned request Schema, so a non-canonical request can only fail the
comparison, never produce a false PASS. `ALREADY` is accepted only when the same
six fields equal the parsed target; the values are the Owner's authoritative flow
state from its exact-occurrence comparison, not an independent observation.

`APPLIED` is deliberately **not** RAN/UE acceptance. The state ladder is:

1. `PFCP_APPLIED` - the UPF accepted the QER update.
2. `N1N2_DISPATCHED` - the SMF handed the native Modify to the relay.
3. `RAN_MODIFICATION_CONFIRMED` - the N2 Modify Response has been received and
   correlated; this is an E2E acceptance observation, not this Operation.
4. `TARGET_STATE_VERIFIED` - an independent Owner read (for example the SMF
   `/pdu-info` per-flow projection) equals the requested target.

The Skill Predicate closes levels 1-2. A Host must not report the business Goal
as "target state verified" from `APPLIED` alone, and no
`RAN_MODIFICATION_CONFIRMED` claim may be made unless the N2 response was
actually observed.

## Host binding

The current OpenAMSM agent_step path rejects standard Nsmf Update business
admission. The Host / Owner must publish a private binding for a new Modify
invocation. A callback completing an existing Establishment s10 or Modify
occurrence must resume that exact original invocation, never create a new Modify
Run.

## Qualification scenario matrix

| Scenario | Expected contract | Evidence status |
| --- | --- | --- |
| UE_INITIATED | Host-authenticated new UE modification; exact SUPI / PSI / generation | Source design only |
| AMF_INITIATED | Host-authenticated new AMF business modification | Source design only |
| NETWORK_TRIGGERED | Trusted internal Owner event; caller cannot choose the entryKind | Source design only |
| Parse read-only | The parse mutates no session state and emits no mutation receipt | Owner unit / source inspection only |
| QoS delta | QFI, target 5QI and the complete GBR/MBR set are validated as one atomic target; the Postcondition must match all six parsed target fields and the dispatch state | Owner unit test PASS (isolated Development build) + negative Predicate tests |
| Applied vs parsed | A different target, a missing field, `PFCP_APPLIED_N1N2_FAILED` or an unknown state cannot satisfy the Goal | Negative Predicate tests |
| Unknown result | SAFE_STOPPED; no retry, compensation or new Run | Route design only |
| Establishment s10 callback | Resume the original Establishment Run; do not start Modify | Host test NOT_RUN |

This matrix is not Runtime, live 5GC or product qualification evidence. The
canonical source package is the authority; the Host fixture is a synchronized
copy and must not carry divergent semantics. Owner publication is still absent.

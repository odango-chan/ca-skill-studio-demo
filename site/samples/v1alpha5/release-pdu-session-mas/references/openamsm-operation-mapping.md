# Release OpenAMSM Scheme C operation mapping

**Status: SOURCE-ALIGNED DESIGN / NOT_QUALIFIED / NOT_LINKABLE.** This mapping
describes the merged Owner Scheme C Release transaction. It is not a published
Owner ToolCatalog, receipt or Runtime result.

## Pinned source

- Repository: odango-chan/env-openamsm
- Commit: 594dec78b95bff4fdc34deac8a3a9681fb41228f
- Historical plan: upstream/openamsm/tools/nw-agent/plans/release/pdu-rel-v4.yaml
- Plan blob SHA: 849c3206569d452a663d1b8d42a63ffdc367be31
- Implementation: src/smf/mas/ssm/ssm_ue.c, src/smf/mas/upn/upnode.c,
  src/smf/mas/pa/policy_adapter.c, src/smf/mas/sc/session_context.c,
  src/smf/mas/se/session_exposure.c, lib/pfcp/xact.h

The pinned OES plan is historical provenance only. Its declared
`UPN.DELETE_UP_SESSION -> SSM.SIGNAL_UE_AN -> PA.DELETE_SM_POLICY ->
SC.RELEASE_SM_CONTEXT -> SE.EMIT_EVENTS` sequence is superseded by the merged
Owner transaction and is not the execution order this Skill implements.

## Procedure mapping

| CA-SL node | Owner callable | Effect | Inputs | Declared Owner outputs |
| --- | --- | --- | --- | --- |
| `validate-release-request` | none (Predicate) | - | `supi`, `pduSessionId`, `entryKind` | - |
| `parse-n1` | `SSM.PARSE_N1_RELEASE` | READ | `ue_identity`, `psi`, `parse_n1=1`; exact retained 0xd1 N1 | `release_intent`, `psi`, `pti`, optional `cause` |
| `build-command` | `SSM.BUILD_RELEASE_COMMAND` | MUTATION | `ue_identity`, `psi`, `release=1`, `mode=build`, `trigger`, parsed `pti` | `release_phase`, `n1_sm_hex`, `n2_sm_hex`, `n2_sm_info_type`, `release_txn`, `release_generation` |
| `confirm-n1` | `SSM.RELEASE_CONFIRM_N1` | MUTATION | `ue_identity`, `psi`, `release_confirm=n1`, `release_txn`, `release_generation` | `n1_released` |
| `confirm-n2` | `SSM.RELEASE_CONFIRM_N2` | MUTATION | `ue_identity`, `psi`, `release_confirm=n2`, `release_txn`, `release_generation` | `n2_released`, `release_ready` |
| `delete-policy` | `PA.DELETE_SM_POLICY_C` | MUTATION | `ue_identity`, `psi`, `release=1`, `trigger` | `terminated` |
| `delete-user-plane` | `UPN.DELETE_UP_SESSION` | MUTATION | `ue_identity`, `psi`, `trigger` | `released` |
| `emit-release-event` | `SE.EMIT_RELEASE_EVENT_C` | MUTATION | `ue_identity`, `psi`, `ev=RELEASED` | `last_event` |
| `release-sm-context` | `SC.RELEASE_SM_CONTEXT_C` | MUTATION | `ue_identity`, `psi`, `release=1`, `finalize=1`, `trigger` | `lifecycle` |
| `verify-release-completion` | none (Postcondition) | - | every preceding Owner output | - |

## Public request boundary

The Release Request Schema is closed and carries only `pduSessionId`,
`entryKind` and `trigger`. `entryKind` is only `UE_INITIATED`; only
`trigger=2` (`UE_REQUESTED`) is selected by this Skill's entry. Other trigger
values belong to AMF-initiated or network-initiated variants that are out of
scope for this version and must be reported NOT_RUN / BLOCKED rather than
coerced.

The raw N1 and the Host-private release transaction id are not Skill-authored
request fields. The typed Provider resolves the retained N1 from trusted private
context at dispatch time. `release_txn` and `release_generation` are created by
the Build occurrence and passed only to the confirmations; they never appear in
the request Schema.

## Read-only parse and the single PTI binding

The parse is read-only and must not mutate session state. It validates EPD / PSI
/ PTI / message type and returns `release_intent=ue_requested`, `psi` and `pti`.
It must not bind the PTI to the session and emits no mutation receipt.

The Build occurrence is the only PTI binding. It is the transaction-controlled
binding that builds the N1 Release Command (0xd3) and the N2 PDU Session Resource
Release Command, records `release_txn` / `release_generation`, and lets the Host
send the command to the AMF. `confirm-n1` and `confirm-n2` are independent and
order-free but both are bound to that same Build transaction / generation. A
confirmation must be bound to the original Run; a duplicate, late or
old-generation answer must never dispatch the cleanup twice.

## Trigger classification

The Host derives `entryKind` and the numeric trigger from authenticated SBI
ingress or a trusted internal event. The caller cannot select either field.

| entryKind | trigger | Source constant | This Skill |
| --- | ---: | --- | --- |
| UE_INITIATED | 2 | UE_REQUESTED | selected |
| AMF_INITIATED | 6 | AMF_RELEASE_SM_CONTEXT | out of scope |
| AMF_INITIATED | 7 | AMF_UPDATE_SM_CONTEXT | out of scope |
| NETWORK_TRIGGERED | 1 | LOCAL_INITIATED | out of scope |
| NETWORK_TRIGGERED | 3 | PCF_INITIATED | out of scope |
| NETWORK_TRIGGERED | 4 | RAN_INITIATED | out of scope |
| NETWORK_TRIGGERED | 5 | SMF_INITIATED | out of scope |

## Cleanup order and exclusions

Scheme C performs the cleanup exactly once after both confirmations, in the
merged Owner order: policy association delete, user-plane session delete, local
release event marker, then SM Context release/finalize. This order is not the
historical OES plan order.

1. Charging delete is optional and has no applicability predicate. It is omitted;
   its adapter only clears a local marker and records `NOT_IMPL_skip`.
2. Compensation is `execute: skip` and is not a Procedure node;
   `compensate_then_replan_once` is not imported. No retry or replan is authored.
3. `terminated` is a real `PA.DELETE_SM_POLICY_C` output and is compared with
   `"1"`; it is not a synthetic field.
4. `last_event` is a real local in-memory marker output and is compared with
   `"1"`; no persistence, 3GPP Status Notify or external delivery is claimed.
5. `lifecycle=RELEASING` is the only SC output. The Host owns any later ResourceMap
   tombstone; the Skill does not claim RELEASED.

## Qualification scenario matrix

| Scenario | Expected contract | Evidence status |
| --- | --- | --- |
| UE_INITIATED | Trigger 2, UE_REQUESTED, closed request Schema | Source design only |
| Parse read-only | No session mutation and no PTI binding | Owner unit / source inspection only |
| Build binding | Build is the only PTI binding and records the transaction / generation | Owner test NOT_RUN |
| Confirmation binding | Both confirmations bound to the original Run's Build; duplicate/late/old generation rejected | Owner / Host test NOT_RUN |
| PFCP deletion | `delete-user-plane` completes only after the exact PFCP delete response | Owner test NOT_RUN |
| PCF deletion | `delete-policy` evidence distinguishes deleted from absent | Owner test NOT_RUN |
| Release event | `last_event` is the local in-memory marker only | Source inspection only |
| Unknown outcome | SAFE_STOPPED; no retry, compensation or replan | Route design only |
| Release completion | `lifecycle` remains RELEASING; Host tombstone is separate | Host test NOT_RUN |
| AMF / network initiated | Out of scope; NOT_RUN / BLOCKED, never coerced into this Skill | Host test NOT_RUN |

This matrix is not Runtime, live 5GC or product qualification evidence. Owner
publication is still absent.

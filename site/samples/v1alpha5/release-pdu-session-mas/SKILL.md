---
name: release-pdu-session-mas
description: Source-aligned CA-SL v1alpha5 Release Procedure for the OpenAMSM MAS pdu-rel-v4 profile.
---

# Release PDU Session — OpenAMSM MAS profile

**Source language:** CA-SL v1alpha5.

**Adoption state: NOT_QUALIFIED / NOT_LINKABLE.** This package defines a source-aligned Procedure. The required MAS ToolCatalog exports, new v0.3.0 candidate Schemas, mutation receipts, Evidence Guarantees, Owner identity and deployment CapabilityContracts are not published. Compiler linking must fail closed.

## Scope

This Skill models release of an existing PDU Session. It does not create a session and does not replace Establishment. The Host authenticates and classifies the ingress, binds the exact SUPI / PSI / current generation, and invokes this Procedure with a normalized request envelope.

The Skill does not expose raw NAS / NGAP bytes, Host ResourceMap keys, Owner session references, invocation IDs, generation IDs or transport correlation handles.

## Entry variants and numeric trigger

The Host, not the caller, derives request.entryKind and request.trigger from authenticated SBI ingress or a trusted internal Owner event:

| Host entryKind | OpenAMSM trigger | Source meaning |
| --- | ---: | --- |
| UE_INITIATED | 2 | UE_REQUESTED |
| AMF_INITIATED | 6 | AMF_RELEASE_SM_CONTEXT |
| AMF_INITIATED | 7 | AMF_UPDATE_SM_CONTEXT |
| NETWORK_TRIGGERED | 1 | LOCAL_INITIATED |
| NETWORK_TRIGGERED | 3 | PCF_INITIATED |
| NETWORK_TRIGGERED | 4 | RAN_INITIATED |
| NETWORK_TRIGGERED | 5 | SMF_INITIATED |

The numeric values are the pinned OpenAMSM constants. In particular, RAN_INITIATED is classified as NETWORK_TRIGGERED while retaining trigger=4. The Procedure checks that entryKind and trigger agree. The Host must not accept these fields as caller-selected authorization claims.

This classification is Host-owned, not new CA-SL syntax. The Procedure is not a public SBI endpoint and does not relax OpenAMSM's current agent_step admission behavior.

## Source progression

The Procedure includes the mandatory OES steps r2 through r6:

1. r2 — UPN.DELETE_UP_SESSION; deletes the UP session and completes only after the matching PFCP deletion result. The released=1 output is not emitted merely because a delete request was sent.
2. r3 — SSM.SIGNAL_UE_AN with release=1 and the numeric trigger. For triggers 1, 6 and 7, the pinned source sends no N1/N2 release signal. For triggers 2, 3, 4 and 5, it sends the applicable N1/N2 release and remains pending until the matching AMF release confirmation.
3. r4 — PA.DELETE_SM_POLICY; completes the PCF association deletion. Evidence must distinguish DELETED from a verified NOT_PRESENT association. The OES plan declares no public output.
4. r5 — SC.RELEASE_SM_CONTEXT; performs the source's UDM unsubscribe / UECM deregistration / AMF acknowledgement phases. The plan exposes lifecycle=RELEASING, not RELEASED.
5. r6 — SE.EMIT_EVENTS with ev=RELEASED; the source updates a local in-memory MAS marker. The plan declares no public output. This is not a durable event record or a 3GPP SM Context Status Notify.

The source plan marks r1 CA.DELETE_CHARGING optional and supplies no applicability predicate. It is deliberately omitted; the Procedure does not call it unconditionally. The pinned CA adapter only clears a local marker and does not delete a CHF charging resource.

OES r7 COMPENSATE_RELEASE is explicitly execute: skip. It is not a Procedure Node. The OES compensate_then_replan_once policy is not imported. An unknown Mutation result must never trigger a blind retry or a new Release sequence.

## Known source blocker

The pinned Release plan declares start_inputs as an empty object but references from_start: trigger in both r2 and r3. This is a source-plan input declaration defect. The Owner must not invent a default or bypass the plan validation; the upstream plan must declare the typed trigger input before these two Operations can be linked and qualified.

## Host / Owner boundary

The current OpenAMSM agent_step admission path rejects the standard Nsmf business Release route. The missing Owner-private binding and publication are explicit blockers; this Skill does not relax the protocol admission gate or invent a public SBI route.

The Owner must retain each pending occurrence and generation. Late callbacks may complete only the original r3 or r5 Owner operation; they must never resume a newer Run. The Host owns external URI ResourceMap tombstoning after the exact Release lifecycle has settled. That Host-owned action is outside this Procedure and is not inferred from lifecycle=RELEASING.

See the [pinned operation mapping](references/openamsm-operation-mapping.md), the shared [source mapping](../../../docs/mas-lifecycle-source-mapping.md), the [Owner outcome contract](../../../docs/mas-lifecycle-owner-contract.md) and the [acceptance matrix](../../../docs/mas-lifecycle-acceptance-matrix.md).

## Goal boundary

A successful Invocation proves that the mandatory source-declared Release Owner steps completed for the same SUPI / PSI / generation, including PFCP UP-session deletion, the exact SSM release disposition, PCF association disposition, SM Context release progression and the local in-memory release marker.

It does not claim a real CHF deletion, a 3GPP Status Notify from r6, a Host ResourceMap tombstone, a final RELEASED lifecycle state, or product / live 5GC qualification.

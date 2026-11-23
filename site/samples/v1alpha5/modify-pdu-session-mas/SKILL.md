---
name: modify-pdu-session-mas
description: Source-aligned CA-SL v1alpha5 Modify Procedure for the OpenAMSM MAS pdu-mod-v3 profile.
---

# Modify PDU Session — OpenAMSM MAS profile

**Source language:** CA-SL v1alpha5.

**Adoption state: NOT_QUALIFIED / NOT_LINKABLE.** This package defines a source-aligned Procedure. The required MAS ToolCatalog exports, new v0.3.0 candidate Schemas, mutation receipts, Evidence Guarantees, Owner identity and deployment CapabilityContracts are not published. Compiler linking must fail closed.

## Scope

This Skill models a QoS-parameter modification of an already admitted PDU
Session. The request carries one closed GBR/MBR delta for an existing GBR QoS
flow; a non-GBR flow is rejected rather than mutated with an illegal bitrate. It is separate from initial establishment and release. The Host authenticates and classifies the ingress, binds the exact SUPI / PSI / current session generation, and invokes this Procedure with a normalized request envelope.

The Skill does not create an SM Context, re-query AMF registration, consume raw NAS / NGAP bytes, or expose Host / Owner correlation handles. The original binary payload and private session references remain inside the responsible Host / Owner adapters.

## Entry variants

The Host constructs request.entryKind after authenticating and classifying the business event:

- UE_INITIATED — a new UE-originated modification delivered through Nsmf UpdateSMContext.
- AMF_INITIATED — a new AMF-originated UpdateSMContext business action.
- NETWORK_TRIGGERED — a trusted internal Owner event, such as a PCF / AF policy trigger or a local network decision.

These variants converge on the same pinned pdu-mod-v3 sequence. This classification belongs to the Host; it is not new CA-SL syntax. A response that completes an already pending Operation is not a new entry variant.

**Important:** an N2 Setup Response that completes the existing Establishment s10 OWNER_DEFERRED occurrence must resume that same Establishment Operation in the original Run. It must not start this Modify Skill or create a new Run. The same rule applies to a late response for a pending Modify m4 occurrence: it belongs to m4's original Owner invocation and generation.

## Source progression

The Procedure includes only mandatory OES steps:

1. m0 — SC.UPDATE_SM_CONTEXT; updates the existing SM Context lifecycle. Its declared OES output is lifecycle.
2. m3 — UPN.MODIFY_UP_SESSION with up_intent=1 and no AN tunnel; prepares the UPN state and returns n4_seid.
3. m4 — SSM.SIGNAL_UE_AN; this Modify occurrence obtains the AN tunnel tuple. The Owner must keep it pending until the matching AN result is known.
4. m5 — UPN.MODIFY_QOS_FLOWS with the m3 N4 SEID, the m4 AN tunnel and one closed QoS delta; performs the PFCP QoS modification and completes only after the native N1/N2 Modify has been dispatched.

m3 and m5 invoke different source branches and are different Mutation occurrences with different input and output shapes. m3 uses a distinct typed CA callable profile. m5 uses the dedicated typed QoS-delta callable: the exact target QFI, 5QI and GBR/MBR set are inputs, and the result reports the applied target together with `qos_delta_state` and `n1n2_dispatched`. It does not reuse or widen the Establishment s11 `n3_synced` profile. m4 also uses a distinct callable profile: the Establishment s10 input Schema is not valid for the Modify occurrence.

The source plan marks m2 CA.UPDATE_CHARGING optional and supplies no applicability predicate. It is deliberately omitted; the Procedure does not call it unconditionally. The pinned CA adapter is a NOT_IMPL_skip marker, not a CHF charging reservation. No charging capability is granted by this Skill.

## Host / Owner boundary

The current OpenAMSM agent_step admission path rejects the standard Nsmf business Update route. The missing Owner-private binding and publication are explicit blockers. This Skill does not relax that protocol gate or invent a new public SBI route.

Every callable occurrence is a candidate MUTATION. The Owner must provide exact occurrence identity, durable commit receipts, SUPI / PSI / generation Scope binding and Evidence. A raw HTTP response, a source marker, or a reused session value is not proof of the current invocation.

See the [pinned operation mapping](references/openamsm-operation-mapping.md), the shared [source mapping](../../../docs/mas-lifecycle-source-mapping.md), the [Owner outcome contract](../../../docs/mas-lifecycle-owner-contract.md) and the [acceptance matrix](../../../docs/mas-lifecycle-acceptance-matrix.md).

## Goal boundary

A successful Invocation proves that the mandatory source-declared Modify Owner steps completed for the same SUPI / PSI / generation: the SM Context is operational, the m3 intent result is available, m4 has the matching AN tunnel, and m5 reports the exact requested QoS target as `APPLIED` (PFCP QER accepted and the native N1/N2 Modify handed to the relay) or `ALREADY` (the authoritative flow already equals the exact request).

The final Postcondition does not trust the state string alone. It compares the
Owner result against the full requested delta, field by field: `qfi`, `five_qi`,
`gfbr_ul`, `gfbr_dl`, `mfbr_ul` and `mfbr_dl`. All are canonical decimal
strings (base-10 digits, no sign, no leading zero) under the Owner contract and
in the Owner result Schema, so the comparison uses CEL string equality as exact
numeric equality without implicit conversion, floating point or precision loss.
The Skill request Schema does not redeclare `pattern` because CA-SL v1alpha5
rejects that keyword; a non-canonical request can only fail closed. `APPLIED` additionally requires `n1n2_dispatched == "1"`; `ALREADY`
requires that no N1/N2 dispatch was reported. A missing field, a different
target, `PFCP_APPLIED_N1N2_FAILED` or an unknown state cannot satisfy the Goal.

For `ALREADY`, the reported target is the Owner's authoritative flow state at
the time of its exact-occurrence comparison; it is not an independent
post-modification observation. The Skill therefore claims only the Owner's
exact-state comparison, and the Host keeps the narrower Development declaration
instead of fabricating an independent read.

**Completion scopes are distinct.** `APPLIED` is not RAN/UE acceptance:
`PFCP_APPLIED` and `N1N2_DISPATCHED` are Owner facts on this Operation.
`RAN_MODIFICATION_CONFIRMED` requires the separate N2 Modify Response, and
`TARGET_STATE_VERIFIED` requires an independent Owner read (for example the
SMF `/pdu-info` projection). Neither is produced by this Skill's Predicate, and
the Host must not report the business Goal as "target state verified" merely
because the Owner returned `APPLIED`. The business Goal
`pdu_session.qos_delta_applied` means exactly levels 1–2 (PFCP applied plus
N1/N2 dispatched) on the exact target; levels 3–4 remain separate evidence.

This is not proof of live 5GC qualification, user-plane traffic success, a CHF reservation, Host ResourceMap mutation, or completion of an unrelated Establishment callback.

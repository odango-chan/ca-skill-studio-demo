# Modify OES operation mapping

**Status: SOURCE-ALIGNED DESIGN / NOT_QUALIFIED / NOT_LINKABLE.**

## Pinned source

- Repository: odango-chan/env-openamsm
- Commit: 594dec78b95bff4fdc34deac8a3a9681fb41228f
- Plan: upstream/openamsm/tools/nw-agent/plans/modify/pdu-mod-v3.yaml
- Plan blob SHA: 8a2caf343c29bb64cbb09b29994c79ac8ad5da05
- Implementation: src/smf/mas/sc/session_context.c, src/smf/mas/upn/upnode.c, src/smf/mas/ssm/ssm_ue.c

## Procedure mapping

| CA-SL Node | OES operation | Candidate callable | Effect | Input Schema | Output Schema | OES inputs / outputs |
| --- | --- | --- | --- | --- | --- | --- |
| m0 | SC.UPDATE_SM_CONTEXT | SC.UPDATE_SM_CONTEXT | MUTATION | wtlab:openamsm:mas:v0.3.0:sc-update-sm-context-input | wtlab:openamsm:mas:v0.3.0:sc-update-sm-context-result | no OES inputs; lifecycle |
| m3 | UPN.MODIFY_UP_SESSION | UPN.MODIFY_UP_SESSION_INTENT | MUTATION | wtlab:openamsm:mas:v0.3.0:upn-modify-intent-input | wtlab:openamsm:mas:v0.3.0:upn-modify-intent-result | up_intent='1'; n4_seid |
| m4 | SSM.SIGNAL_UE_AN | SSM.SIGNAL_UE_AN_MODIFY | MUTATION | wtlab:openamsm:mas:v0.3.0:ssm-signal-ue-an-modify-input | wtlab:openamsm:mas:v0.2.0:ssm-signal-ue-an-result | no OES inputs; an_tunnel_teid, an_tunnel_ip, an_tunnel |
| m5 | UPN.MODIFY_UP_SESSION | UPN.MODIFY_QOS_FLOWS | MUTATION | wtlab:openamsm:mas:v0.3.0:upn-modify-qos-flows-input | wtlab:openamsm:mas:v0.3.0:upn-modify-qos-flows-result | an_tunnel_teid, an_tunnel_ip, n4_seid, qos_flows_delta='1', qfi, five_qi, gfbr_ul/dl, mfbr_ul/dl -> qos_delta_state, n1n2_dispatched, applied target |

The CA-facing ue_identity and psi values bind the exact SUPI / PSI Scope. For m0 and m4 they are Owner-only Scope inputs and are not forwarded as OES step inputs.

m3 and m5 are distinct Mutation occurrences with distinct callable profiles. m3 invokes the no-tunnel UPN branch: the source applies the intent state and returns n4_seid. m5 invokes the typed QoS-delta branch: the Owner validates one closed QFI/5QI/GBR/MBR target, parks the exact PFCP transaction, and completes only after the PFCP response is accepted and the native N1/N2 Modify has been handed to the relay. The input includes the exact delta; the output reports `qos_delta_state=APPLIED|ALREADY`, `n1n2_dispatched=1` (APPLIED only), and the applied target. Neither the v0.2.0 `n3_synced` profile nor the Establishment s11 profile is reused or widened.

m4 is not Establishment s10. Its input shape is different even though its declared AN tunnel output shape matches the existing s10 output Schema. It therefore has its own callable and input Schema.

## Optional source step

OES m2 CA.UPDATE_CHARGING is optional and has no applicability predicate in the pinned plan. It is omitted from this Procedure and from its Capability grants. The current adapter writes only a local charging marker and records NOT_IMPL_skip; it does not reserve CHF charging.

## Completion semantics

| Output | Meaning |
| --- | --- |
| `qos_delta_state=APPLIED` | The PFCP Update QER was accepted and the native N1/N2 Modify was dispatched. |
| `qos_delta_state=ALREADY` | The authoritative flow already equals the exact requested target; no PFCP was sent and no N1/N2 was dispatched. |
| `n1n2_dispatched=1` | Present only for APPLIED; the relay send was checked. |
| `qfi`, `five_qi`, `gfbr_*`, `mfbr_*` | The applied target after the transaction, as canonical decimal strings. |

The Postcondition compares every one of those target fields with the requested
delta. The Owner contract reports canonical decimal strings (base-10, no sign,
no leading zero), so equality is exact numeric equality; no implicit
conversion, floating point or precision loss is involved. CA-SL v1alpha5 does
not accept `pattern` in a Skill-owned request Schema, so a non-canonical
request can only fail the comparison (never a false PASS). `ALREADY` is accepted only when the same
six fields equal the request; the values are the Owner's authoritative flow
state from its exact-occurrence comparison, not an independent observation.

`APPLIED` is deliberately **not** RAN/UE acceptance. The state ladder is:

1. `PFCP_APPLIED` — the UPF accepted the QER update.
2. `N1N2_DISPATCHED` — the SMF handed the native Modify to the relay.
3. `RAN_MODIFICATION_CONFIRMED` — the N2 Modify Response has been received and
   correlated; this is an E2E acceptance observation, not this Operation.
4. `TARGET_STATE_VERIFIED` — an independent Owner read (for example the SMF
   `/pdu-info` per-flow projection) equals the requested target.

The Skill Predicate closes levels 1-2. A Host must not report the business Goal
as "target state verified" from `APPLIED` alone, and no `RAN_MODIFICATION_CONFIRMED`
claim may be made unless the N2 response was actually observed.

## Host binding

The current OpenAMSM agent_step path rejects standard Nsmf Update business admission. The Host / Owner must publish a private binding for a new Modify invocation. A callback completing an existing Establishment s10 or Modify m4 occurrence must resume that exact original invocation, never create a new Modify Run.

## Qualification scenario matrix

| Scenario | Expected contract | Evidence status |
| --- | --- | --- |
| UE_INITIATED | Host-authenticated new UE modification; exact SUPI / PSI / generation | Source design only |
| AMF_INITIATED | Host-authenticated new AMF business modification | Source design only |
| NETWORK_TRIGGERED | Trusted internal Owner event; caller cannot choose the entryKind | Source design only |
| m3 / m5 profile split | Separate input/output Schemas and Mutation receipts; m5 uses the dedicated v0.3.0 QoS-delta profile, not the v0.2.0 `n3_synced` profile | Static regression only |
| QoS delta | QFI, target 5QI and the complete GBR/MBR set are validated as one atomic target; `gbr <= mbr`; the Postcondition must match all six target fields and the dispatch state | Owner unit test PASS (isolated Development build) + negative Predicate tests |
| m4 pending result | Complete only on the matching AN result for the original occurrence | Host / Owner test NOT_RUN |
| Unknown result | SAFE_STOPPED; no retry, compensation or new Run | Route design only |
| Establishment s10 callback | Resume the original Establishment Run; do not start Modify | Host test NOT_RUN |

This matrix is not Runtime, live 5GC or product qualification evidence. The
canonical source package is the authority; the Host fixture is a synchronized
copy and must not carry divergent semantics.

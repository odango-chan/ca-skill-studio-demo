# Release OES operation mapping

**Status: SOURCE-ALIGNED DESIGN / NOT_QUALIFIED / NOT_LINKABLE.**

## Pinned source

- Repository: odango-chan/env-openamsm
- Commit: 594dec78b95bff4fdc34deac8a3a9681fb41228f
- Plan: upstream/openamsm/tools/nw-agent/plans/release/pdu-rel-v4.yaml
- Plan blob SHA: 849c3206569d452a663d1b8d42a63ffdc367be31
- Implementation: src/smf/mas/upn/upnode.c, src/smf/mas/ssm/ssm_ue.c, src/smf/mas/pa/policy_adapter.c, src/smf/mas/sc/session_context.c, src/smf/mas/se/session_exposure.c, lib/pfcp/xact.h

## Procedure mapping

| CA-SL Node | OES operation | Candidate callable | Effect | Input Schema | Output Schema | OES inputs / outputs |
| --- | --- | --- | --- | --- | --- | --- |
| r2 | UPN.DELETE_UP_SESSION | UPN.DELETE_UP_SESSION | MUTATION | wtlab:openamsm:mas:v0.3.0:upn-delete-up-session-input | wtlab:openamsm:mas:v0.3.0:upn-delete-up-session-result | trigger; released |
| r3 | SSM.SIGNAL_UE_AN | SSM.SIGNAL_UE_AN_RELEASE | MUTATION | wtlab:openamsm:mas:v0.3.0:ssm-signal-ue-an-release-input | wtlab:openamsm:mas:v0.3.0:ssm-signal-ue-an-release-result | release='1', trigger; no output |
| r4 | PA.DELETE_SM_POLICY | PA.DELETE_SM_POLICY | MUTATION | wtlab:openamsm:mas:v0.3.0:pa-delete-sm-policy-input | wtlab:openamsm:mas:v0.3.0:pa-delete-sm-policy-result | release='1'; no output |
| r5 | SC.RELEASE_SM_CONTEXT | SC.RELEASE_SM_CONTEXT | MUTATION | wtlab:openamsm:mas:v0.3.0:sc-release-sm-context-input | wtlab:openamsm:mas:v0.3.0:sc-release-sm-context-result | release='1'; lifecycle |
| r6 | SE.EMIT_EVENTS | SE.EMIT_RELEASE_EVENT | MUTATION | wtlab:openamsm:mas:v0.3.0:se-emit-release-event-input | wtlab:openamsm:mas:v0.3.0:se-emit-release-event-result | ev='RELEASED'; no output |

All operation input objects are closed. ue_identity and psi are Owner Scope bindings; release / trigger / ev are the exact source inputs. The empty output Schemas for r3, r4 and r6 contain no business fields.

## Trigger classification

The Host derives entryKind and numeric trigger from authenticated SBI ingress or a trusted internal Owner event. The caller cannot select either field.

| entryKind | trigger | Source constant |
| --- | ---: | --- |
| UE_INITIATED | 2 | UE_REQUESTED |
| AMF_INITIATED | 6 | AMF_RELEASE_SM_CONTEXT |
| AMF_INITIATED | 7 | AMF_UPDATE_SM_CONTEXT |
| NETWORK_TRIGGERED | 1 | LOCAL_INITIATED |
| NETWORK_TRIGGERED | 3 | PCF_INITIATED |
| NETWORK_TRIGGERED | 4 | RAN_INITIATED |
| NETWORK_TRIGGERED | 5 | SMF_INITIATED |

The SSM source skips N1/N2 for triggers 1, 6 and 7. For triggers 2, 3, 4 and 5 it sends the appropriate release signaling and parks the original Operation until the matching AMF release confirmation. The Host must not start a new Run for a late response.

## Source blockers and exclusions

1. pdu-rel-v4.yaml declares start_inputs: {} but r2 and r3 reference from_start: trigger. The upstream plan must declare the typed trigger input. The Owner must not invent a default or bypass validation.
2. r1 CA.DELETE_CHARGING is optional and has no applicability predicate. It is omitted. Its pinned adapter only clears a local marker and records NOT_IMPL_skip; it does not delete a CHF resource.
3. r7 COMPENSATE_RELEASE is execute: skip. It is not a Procedure Node. compensate_then_replan_once is not imported.
4. r4's C implementation may set a private terminated marker, but the OES plan declares no output. The Skill exposes no terminated field.
5. r6 updates an in-memory last_event marker. The OES plan declares no output; the Skill exposes no last_event field and does not claim persistence or 3GPP notification.
6. r5 exposes lifecycle=RELEASING. The Host owns later ResourceMap tombstoning; the Skill does not claim RELEASED.

## Qualification scenario matrix

| Scenario | Expected contract | Evidence status |
| --- | --- | --- |
| UE_INITIATED | Trigger 2, UE_REQUESTED | Source design only |
| AMF_INITIATED | Trigger 6 or 7, AMF Release / Update | Source design only |
| NETWORK_TRIGGERED | Trigger 1, 3, 4 or 5, trusted network event | Source design only |
| PFCP deletion | r2 completes only after the exact PFCP delete response | Owner test NOT_RUN |
| SSM signal skip | Trigger 1, 6 or 7 completes with source-derived no-signal evidence | Owner test NOT_RUN |
| SSM signal required | Trigger 2, 3, 4 or 5 waits for matching AMF confirmation | Owner / Host test NOT_RUN |
| PCF deletion | r4 evidence distinguishes DELETED from NOT_PRESENT | Owner test NOT_RUN |
| Late callback | Resume only the original pending occurrence and generation | Host test NOT_RUN |
| Unknown outcome | SAFE_STOPPED; no retry, compensation or replan | Route design only |
| Release completion | r5 lifecycle remains RELEASING; Host tombstone is separate | Host test NOT_RUN |

This matrix is not Runtime, live 5GC or product qualification evidence.

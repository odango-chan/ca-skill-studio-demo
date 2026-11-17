# OpenAMSM source mapping for establish-pdu-session-mas

**Status: SOURCE-ALIGNED DESIGN / NOT_QUALIFIED / NOT_LINKABLE.** This document records what the imported OpenAMSM source and NW Agent plan actually implement. It is not a published MAS ToolCatalog, a 3GPP procedure, or runtime acceptance evidence.

## Pinned source baseline

- Repository: [env-openamsm](https://github.com/odango-chan/env-openamsm)
- Imported source snapshot commit: [77c0a2f8511c3498d1270f059881b3cf0f7f5eeb](https://github.com/odango-chan/env-openamsm/commit/77c0a2f8511c3498d1270f059881b3cf0f7f5eeb)
- NW Agent plan: `upstream/openamsm/tools/nw-agent/plans/establish/pdu-internet-policy-first-v1.yaml`
- OES dispatch: `upstream/openamsm/src/smf/mas/common/mas-facade.c`
- OES plan identity: `wf-certified-pdu-est-policy-first-v1`, MAS capability `sm-mas-ops/3.2`, OES DSL `1.3`

The Skill uses source-derived candidate callable IDs such as `mas::SC.VALIDATE_SUBSCRIPTION`. These are **not** trusted ToolCatalog exports. The `mas` dependency is an `urn:example:` placeholder, so Compiler linking must fail closed until the actual Owner publishes exact callable IDs, Effects, input/output Schemas, outcomes and Evidence.

## Input and identity binding

The NW Agent plan starts with:

| Plan input | Source | Skill/Owner mapping |
|---|---|---|
| `ue_identity` | admitted CreateSMContext request `/supi` | Skill passes the same 3GPP `supi` value; Owner maps it to the OES `ue_identity` field without inventing an intermediate UE reference |
| `psi` | `/pduSessionId` | Skill `request.pduSessionId` |
| `dnn` | `/dnn` | Skill `request.dnn` |
| `s_nssai` | `/sNssai/sst` | Skill `request.sNssai.sst` |
| `s_nssai_sd` | `/sNssai/sd`, default empty string | Skill `request.sNssai.sd` as the 3GPP six-hex-digit string; when absent, the Owner supplies the OES plan's empty-string default |
| `pdu_session_type` | `/pduSessionType` | Skill `request.requestedPduSessionType` |
| `gpsi` | optional `/gpsi`, default empty | Owner-private optional input; not part of this example request Schema |
| `secondary_auth_required` | literal `'0'` | Fixed out-of-profile skip; not a dynamic subscription-derived decision |
| `allocator` | literal `LOCAL_POOL` | Fixed local-pool profile |

Both Skill request Schemas represent `sNssai.sd` as the 3GPP six-hex-digit hexadecimal string, matching the OpenAMSM plan's string input. The OES plan defaults an absent SD to the empty string; the Owner adapter must apply that exact default rather than stringify a number or invent a value.

The Owner binds every Operation to the exact Host-admitted UE/PSI business instance. The admitted 3GPP `supi` remains the UE identity; no intermediate identity alias is created or resolved. The MAS operations run against the same SMF session; the Skill passes declared business inputs (including 3GPP SUPI and PSI) and typed Operation results, not `stateRef`, Host lifecycle IDs or transport references.

## Operation input boundary

The NW Agent plan's `steps[].inputs` are OES plan fields (mostly snake_case). The Procedure's `mas::...` callables are **candidate CA Tool interfaces**, not literal OES step invocations; their current arguments use 3GPP-shaped or normalized names such as `sNssai`, `pduSessionType`, `sessionKeys`, `upAnchorReady`, `ueAddrAllocated`, `policyAssociationId`, `n4Seid`, `anTunnelTeid` and `anTunnelIp`. These names are not identical to the corresponding OES fields.

Before the MAS Owner publishes a ToolCatalog, each callable Input Schema must make the adapter mapping explicit and typed. Examples include `sNssai.sst → s_nssai`, `sNssai.sd → s_nssai_sd` (absent SD → the plan's empty-string default), `pduSessionType → pdu_session_type`, `sessionKeys → session_keys`, `upIntent → up_intent`, `upAnchorReady → up_anchor`, `ueAddrAllocated → ue_addr`, `policyAssociationId → policy_assoc_id`, `n4Seid → n4_seid`, `anTunnelTeid → an_tunnel_teid`, `anTunnelIp → an_tunnel_ip`, `ratingGroupRefs → rating_group_refs`, `subSummary → sub_summary` and `event → ev`. For NW Agent step s7, the OES input is named `supi`, so the Owner maps the CA-facing `ue_identity` to `supi` there; the plan's other steps that declare `ue_identity` retain that exact name. The exact mapping must be checked against each pinned plan step's declared and required inputs; no implicit camelCase/snake_case conversion may be assumed. The CA-facing `ue_identity` and `psi` are also exact UE/PSI scope bindings for the Owner; some OES steps do not declare them as step inputs, so the adapter uses them for scope validation and forwards only the fields required by that step. Optional OES defaults such as `gpsi`, `s_nssai_sd` and `rating_group_refs` must be applied exactly as the pinned plan specifies.

Therefore, the Skill's `ue_identity` is source-aligned with the plan's `ue_identity` and is populated directly from 3GPP `supi`, but the full Operation argument contract is **not yet proven identical** to the NW Agent plan. Until the Owner schemas and adapter mapping are published, this remains a source-aligned design only, not a qualified or executable one-to-one port.

## Operation-by-operation source mapping

| NW Agent step | MAS / OES operation | Plan outputs | Source-grounded meaning and Skill treatment |
|---|---|---|---|
| s1 | SC / `VALIDATE_SUBSCRIPTION` | `sub_summary` | Calls the SMF UDM SDM Get path and marks the SC subscription state validated. The current source writes summary `"ok"`; this is a CA adapter around UDM, not a separately published 3GPP callable. |
| s2 | SAA / `SECONDARY_AUTH` (optional) | `phase` | Plan hard-codes `required='0'`; source returns `SKIPPED`. This does not perform or dynamically decide secondary authentication. Auth-required profiles are out of scope and the legacy case 06 is not covered by this plan. |
| s3 | SC / `CREATE_SM_CONTEXT` | `session_keys`, `lifecycle`, `sm_context_ref` | Creates/binds the SMF context and sends the early CreateSMContext response when a stream is supplied. `lifecycle` becomes `OPERATIONAL`. The step-5 response is early, not final session success. `sm_context_ref` is an internal source reference and must not be exposed as a 3GPP Location or Host correlation ID. |
| s3r | SC / `REGISTER_UECM` | `uecm_registered` | Performs UDM UECM registration. The MAS plan places it before PCF/N4, earlier than the conventional TS 23.502 step-16c position; this is an explicit MAS ordering deviation. |
| s3p | PA / `CREATE_SM_POLICY` | `up_intent`, `authorized_qos`, `policy_assoc_id` | Performs PCF association creation/binding. The adapter output must be backed by the real PCF result; source fallback `policy_assoc_id="bound"` is not a usable association identity. |
| s4 | UPS / `DECIDE_ANCHOR` | `up_anchor` | Selects the PFCP node internally. Output is a `"1"/"0"` decision marker, not an anchor identifier. |
| s5 | IAM / `ALLOCATE_ADDRESS` | `ue_addr` | With `LOCAL_POOL`, allocates on the SMF session. Output is a `"1"/"0"` allocation marker, not the UE IP address. The actual address stays in SMF session state for UPN/SSM. |
| s6u | PA / `UPDATE_SM_POLICY` | `up_intent`, `authorized_qos`, `policy_assoc_id` | Performs the PCF policy update after address allocation. It is a separate operation from PCF Create and must have its own result/Evidence. |
| s7 | CA / `CREATE_CHARGING` | `charging_ref` | **Current source stub.** `charge_adapter.c` records `NOT_IMPL_skip` and returns marker `charging_ref="1"`; this is not a charging reservation and cannot satisfy a business success Predicate. This is a hard qualification blocker. |
| s8 | UPN / `CREATE_UP_SESSION` | `n4_seid`, `est_done` | Performs N4 Session Establishment. `n4_seid` is one UPF SEID, not an SMF/UPF pair. `est_done` is the source completion marker. |
| s9 | IAM / `CONFIRM_ADDRESS` (optional) | `ue_addr` | Needed for `allocator=UPF` after PFCP establishment. The current Skill fixes `LOCAL_POOL`, so this optional operation is omitted. |
| s10 | SSM / `SIGNAL_UE_AN` | `an_tunnel_teid`, `an_tunnel_ip`, `an_tunnel` | Sends the N1/N2 establishment transfer and remains pending for the exact access-network result/F-TEID. Host correlates the later step-15 UpdateSMContext request to this pending Owner Operation; Runtime resumes the same Invocation. |
| s11 | UPN / `MODIFY_UP_SESSION` | `n3_synced` | Performs the separate N4 Session Modification using the returned RAN F-TEID. This is distinct from initial N4 establishment. |
| s13 | SE / `EMIT_EVENTS` | `last_event` | Records a local MAS event and returns presence marker `"1"`. It is not proof that TS 23.502 step-18 SM Context Status Notify was sent. |
| s14 | SC / `COMPENSATE_RELEASE` | none | The NW plan marks this step `execute: skip` and configures `compensate_then_replan_once`. The source operation exists, but CA-SL must not copy automatic replan or author a compensation Node. It may be used only through a trusted Host/Owner `mutation.reconcile` contract for the exact original mutation. |

## Corrections applied to the Skill source

1. Removed every invented `stateRef` field. The OpenAMSM plan and the mapped outputs do not define `stateRef`.
2. Replaced the invented `mas::ca.pdu_session.*` callable names with source-derived MAS/OES operation identities. They remain placeholders until the Owner publishes them.
3. Added the exact UE/PSI entry Observation after the read-only s1 subscription-validation Operation in the same first business Node. Only `ABSENT` may select initial creation; `PRESENT` (including SC `UNAVAILABLE`) stops safely; query errors are `UNKNOWN`.
4. Renamed the SAA stage to `skip-secondary-authentication` and fixed `required="0"` to match the plan. It is not described as an auth decision.
5. Removed the mandatory address-confirm stage for this fixed `LOCAL_POOL` profile.
6. Renamed the SSM stage to `signal-ue-and-access-network`; it owns the pending N1/N2-to-step-15 completion boundary. There is no extra callback or Wait Node.
7. Removed invented `resources.finalize` and `ca-compensate-confirmed-failure` Tool calls. Resource responsibility and exact-original compensation remain Host/Owner responsibilities.
8. Kept charging as an explicit qualification gate. The current stub's `"1"` marker cannot pass the charging Predicate; therefore this Skill cannot reach `SUCCEEDED` against the current source implementation.
9. Classified `SE.EMIT_EVENTS` as a local CA/MAS extension, not as a 3GPP notification.

## 3GPP and lifecycle deviations

- UECM registration occurs at s3r before PCF and N4, unlike the conventional TS 23.502 step-16c placement.
- The SAA step is always skipped by the current plan input. The six-case legacy suite's secondary-auth-required case is not covered.
- Charging is currently stubbed. No full happy-path qualification is possible until real charging behavior and Evidence are supplied or the business Owner approves a different profile.
- The event record is local MAS state. Do not claim it is step 18.
- The step-3 ingress and paired step-5 early response are Host/SMF service-boundary concerns; the step-5 response is not final Goal proof.
- The later step-15 request completes the pending SSM Owner Operation in the same Invocation. The paired step-17 response remains a Host service-exit obligation after N4 Modification.
- N4 Establishment and N4 Modification are separate proof boundaries.

## Qualification gates

- Publish the exact MAS ToolCatalog and CapabilityContracts with the source-derived callable IDs, Effects, input/output Schemas, declared outcomes and Evidence Guarantees.
- Publish typed Owner output Schemas for the exact fields in the table; do not copy Owner schemas into Skill-owned files.
- Publish and test the Owner's exact mapping from the six-hex-digit `sNssai.sd` string to OES `s_nssai_sd`, including the plan's empty-string default when SD is absent.
- Replace every `urn:example:` Schema, ToolCatalog and Capability placeholder with trusted Owner exports.
- Close the generic SMF context Observation's source-authority and temporal/freshness contract. v0.10 does not supply source timestamps; source inspection alone is not Owner publication.
- Implement real charging or explicitly approve a profile that excludes charging; do not accept the current `NOT_IMPL_skip` marker.
- Publish Host/Owner correlation, Deadline, duplicate/late-result and paired step-17 response contracts for the pending SSM operation.
- Define Host-owned exact-original Reconcile semantics for `SC.COMPENSATE_RELEASE`; do not inherit `compensate_then_replan_once`.
- Revalidate all six legacy MAS Cases. Case 06 is currently unsupported by the fixed `secondary_auth_required='0'` plan.
- Run Compiler/link, Host/Runtime, MAS integration and live 5GC acceptance only after the publication gates close.

This file is a source-based migration record, not evidence that the MAS ToolCatalog, Runtime, charging, or live network path is qualified.

# OpenAMSM source mapping for establish-pdu-session-mas

**Status: SOURCE-ALIGNED DESIGN / NOT_QUALIFIED / NOT_LINKABLE.** This document records what the imported OpenAMSM source and NW Agent plan actually implement. It is not a published MAS ToolCatalog, a 3GPP procedure, or runtime acceptance evidence.

## Pinned source baseline

- Repository: [env-openamsm](https://github.com/odango-chan/env-openamsm)
- Imported source snapshot commit: [77c0a2f8511c3498d1270f059881b3cf0f7f5eeb](https://github.com/odango-chan/env-openamsm/commit/77c0a2f8511c3498d1270f059881b3cf0f7f5eeb)
- NW Agent plan: `upstream/openamsm/tools/nw-agent/plans/establish/pdu-internet-policy-first-v1.yaml`
- OES dispatch: `upstream/openamsm/src/smf/mas/common/mas-facade.c`
- OES plan identity: `wf-certified-pdu-est-policy-first-v1`, MAS capability `sm-mas-ops/3.2`, OES DSL `1.3`

## 3GPP reference baseline

The MAS-to-3GPP comparisons in this mapping use the following independently pinned Release 19 references, checked on 2026-11-17:

| Specification | Version | Relevant mapping |
|---|---|---|
| TS 23.501 | V19.9.0 | SMF/UPF selection, SSC and session-address allocation |
| TS 23.502 | V19.9.0 | §4.3.2.2.1 PDU Session Establishment; §4.4.1.2–§4.4.1.3 N4 procedures |
| TS 23.503 | V19.8.0 | PCC and SM Policy framework |
| TS 29.502 | V19.7.0 | Nsmf CreateSMContext / UpdateSMContext API; OpenAPI Annex A.2 |
| TS 29.500 | V19.7.1 | SBI retry and HTTP deadline semantics |
| TS 29.571 | V19.7.0 | Common SBI data types, including `RefToBinaryData`; OpenAPI Annex A.2 |
| TS 29.503 | V19.7.0 | UDM SDM / UECM APIs; OpenAPI Annex A.2 / A.3 |
| TS 29.512 | V19.6.0 | Npcf_SMPolicyControl API; OpenAPI Annex A.2 |
| TS 29.518 | V19.8.0 | Namf_Communication API; OpenAPI Annex A.2 |
| TS 29.244 | V19.6.0 | PFCP/N4 protocol |

The version numbers are per-specification pins, not one common Release 19 version.

The Nsmf/Namf adapter operations that carry NAS or NGAP content use the 3GPP binary-part model, not a JSON-only or arbitrary base64 convention. TS 29.502 V19.7.0 §6.1.2.4 defines `multipart/related` representations with a JSON root part plus one or more binary body parts; N1 SM uses `application/vnd.3gpp.5gnas` and N2 NGAP uses `application/vnd.3gpp.ngap`. TS 29.571 V19.7.0 §5.4.4.14 defines `RefToBinaryData.contentId` as the referenced binary part's `Content-ID` header value. The Owner/HTTP adapter must bind the JSON reference to the actual bytes and support all binary parts declared by the operation's OpenAPI schema. This framing is adapter responsibility, not Skill-authored HTTP syntax.
 These references classify the standard interactions that the MAS OES source resembles; they do not turn the MAS plan into a normative 3GPP procedure or qualify its candidate callable identities. In particular, the MAS early UECM registration remains an explicit ordering deviation from conventional TS 23.502 V19.9.0 §4.3.2.2.1 step 16c.

Primary ETSI documents: [TS 23.502 V19.9.0](https://www.etsi.org/deliver/etsi_ts/123500_123599/123502/19.09.00_60/ts_123502v190900p.pdf), [TS 29.503 V19.7.0](https://www.etsi.org/deliver/etsi_ts/129500_129599/129503/19.07.00_60/ts_129503v190700p.pdf), [TS 29.512 V19.6.0](https://www.etsi.org/deliver/etsi_ts/129500_129599/129512/19.06.00_60/ts_129512v190600p.pdf), and [TS 29.244 V19.6.0](https://www.etsi.org/deliver/etsi_ts/129200_129299/129244/19.06.00_60/ts_129244v190600p.pdf).


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

The Owner binds every Operation to the exact Host-admitted UE/PSI business instance. The admitted 3GPP `supi` remains the UE identity; no intermediate identity alias is created or resolved. The MAS operations run against the same SMF session; the Skill passes declared business inputs (including 3GPP SUPI and PSI) and typed Operation results, not `stateRef`, Host lifecycle IDs or transport references. The fact that the request reached this authenticated initial `CreateSMContext` entry point is the integration-side admission assumption; registration and CM status are not re-queried inside the Skill. Duplicate/replayed request handling is per original Host admission identity, not a blanket `sessionPresence == ABSENT` requirement.

## Operation input boundary

The NW Agent plan's `steps[].inputs` are OES plan fields (mostly snake_case). The Procedure's `mas::...` callables are **candidate CA Tool interfaces**, not literal OES step invocations; their current arguments use 3GPP-shaped or normalized names such as `sNssai`, `pduSessionType`, `sessionKeys`, `upAnchorReady`, `ueAddrAllocated`, `policyAssociationId`, `n4Seid`, `anTunnelTeid` and `anTunnelIp`. These names are not identical to the corresponding OES fields.

Before the MAS Owner publishes a ToolCatalog, each callable Input Schema must make the adapter mapping explicit and typed. Examples include `sNssai.sst → s_nssai`, `sNssai.sd → s_nssai_sd` (absent SD → the plan's empty-string default), `pduSessionType → pdu_session_type`, `sessionKeys → session_keys`, `upIntent → up_intent`, `upAnchorReady → up_anchor`, `ueAddrAllocated → ue_addr`, `policyAssociationId → policy_assoc_id`, `n4Seid → n4_seid`, `anTunnelTeid → an_tunnel_teid`, `anTunnelIp → an_tunnel_ip`, `ratingGroupRefs → rating_group_refs`, `subSummary → sub_summary` and `event → ev`. For NW Agent step s7, the OES input is named `supi`, so the Owner maps the CA-facing `ue_identity` to `supi` there; the plan's other steps that declare `ue_identity` retain that exact name. The exact mapping must be checked against each pinned plan step's declared and required inputs; no implicit camelCase/snake_case conversion may be assumed. The CA-facing `ue_identity` and `psi` are also exact UE/PSI scope bindings for the Owner; some OES steps do not declare them as step inputs, so the adapter uses them for scope validation and forwards only the fields required by that step. Optional OES defaults such as `gpsi`, `s_nssai_sd` and `rating_group_refs` must be applied exactly as the pinned plan specifies.

Therefore, the Skill's `ue_identity` is source-aligned with the plan's `ue_identity` and is populated directly from 3GPP `supi`, but the full Operation argument contract is **not yet proven identical** to the NW Agent plan. Until the Owner schemas and adapter mapping are published, this remains a source-aligned design only, not a qualified or executable one-to-one port.

## Operation-by-operation source mapping

| NW Agent step | MAS / OES operation | Plan outputs | Source-grounded meaning and Skill treatment |
|---|---|---|---|
| s1 | SC / `VALIDATE_SUBSCRIPTION` | `sub_summary` | Calls the SMF UDM SDM Get path and marks subscription validated. OpenAMSM `/invoke` can materialize an SMF session shell before dispatch, so `READ` is not a proven callable Effect. Until Owner verification, treat as mutation-capable with an `OUTCOME_UNKNOWN` safety route; `"ok"` is a source marker, not an Owner commit proof. |
| s2 | SAA / `SECONDARY_AUTH` (optional) | `phase` | Plan hard-codes `required='0'`; source returns `SKIPPED`. This does not perform or dynamically decide secondary authentication. Auth-required profiles are out of scope and the legacy case 06 is not covered by this plan. |
| s3 | SC / `CREATE_SM_CONTEXT` | `session_keys`, `lifecycle`, `sm_context_ref` | Creates/binds the SMF context and sends the early CreateSMContext response when a stream is supplied. `lifecycle` becomes `OPERATIONAL`. The step-5 response is early, not final session success. `sm_context_ref` is an internal source reference and must not be exposed as a 3GPP Location or Host correlation ID. |
| s3r | SC / `REGISTER_UECM` | `uecm_registered` | Performs UDM UECM registration. The MAS plan places it before PCF/N4, earlier than the conventional TS 23.502 V19.9.0 §4.3.2.2.1 step 16c position; this is an explicit MAS ordering deviation. |
| s3p | PA / `CREATE_SM_POLICY` | `up_intent`, `authorized_qos`, `policy_assoc_id` | Performs PCF association creation/binding. The adapter output must be backed by the real PCF result; source fallback `policy_assoc_id="bound"` is not a usable association identity. |
| s4 | UPS / `DECIDE_ANCHOR` | `up_anchor` | Selects the PFCP node internally. Output is a `"1"/"0"` decision marker, not an anchor identifier. |
| s5 | IAM / `ALLOCATE_ADDRESS` | `ue_addr` | With `LOCAL_POOL`, allocates on the SMF session. Output is a `"1"/"0"` allocation marker, not the UE IP address. The actual address stays in SMF session state for UPN/SSM. |
| s6u | PA / `UPDATE_SM_POLICY` | `up_intent`, `authorized_qos`, `policy_assoc_id` | Performs the PCF policy update after address allocation. It is a separate operation from PCF Create and must have its own result/Evidence. |
| s7 | CA / `CREATE_CHARGING` | `charging_ref` | **Required plan step; successful skip stub in the pinned source.** `mas_charge_adapter_create_invoke` returns `SMF_MAS_OK`, outputs `charging_ref="1"` and records `NOT_IMPL_skip`. The Skill verifies that exact step-completion marker and continues to s8. This is not a charging reservation and is never described as one. |
| s8 | UPN / `CREATE_UP_SESSION` | `n4_seid`, `est_done` | Performs N4 Session Establishment. `n4_seid` is one UPF SEID, not an SMF/UPF pair. `est_done` is the source completion marker. |
| s9 | IAM / `CONFIRM_ADDRESS` (optional) | `ue_addr` | Needed for `allocator=UPF` after PFCP establishment. The current Skill fixes `LOCAL_POOL`, so this optional operation is omitted. |
| s10 | SSM / `SIGNAL_UE_AN` | `an_tunnel_teid`, `an_tunnel_ip`, `an_tunnel` | Sends the N1/N2 establishment transfer and remains pending for the exact access-network result/F-TEID. Host correlates the later step-15 UpdateSMContext request to this pending Owner Operation; Runtime resumes the same Invocation. |
| s11 | UPN / `MODIFY_UP_SESSION` | `n3_synced` | Performs the separate N4 Session Modification using the returned RAN F-TEID. This is distinct from initial N4 establishment. |
| s13 | SE / `EMIT_EVENTS` | `last_event` | Records a local MAS event and returns presence marker `"1"`. It is not proof that TS 23.502 V19.9.0 §4.3.2.2.1 step 18 SM Context Status Notify was sent. |
| s14 | SC / `COMPENSATE_RELEASE` | none | The NW plan marks this step `execute: skip` and configures `compensate_then_replan_once`. The source operation exists, but CA-SL must not copy automatic replan or author a compensation Node. It may be used only through a trusted Host/Owner `mutation.reconcile` contract for the exact original mutation. |

## Corrections applied to the Skill source

1. Removed every invented `stateRef` field. The OpenAMSM plan and the mapped outputs do not define `stateRef`.
2. Replaced the invented `mas::ca.pdu_session.*` callable names with source-derived MAS/OES operation identities. They remain placeholders until the Owner publishes them.
3. The MAS Skill owns initial establishment. Removed the redundant SMF Session ABSENT Observation and its Predicate/Capability because `/invoke` may create an uninitialized Session shell before a nominally read-only s1 Operation. Host authenticates and deduplicates the original initial `CreateSMContext` ingress; no extra AMF registration or CM-CONNECTED lookup is authored. s1 is treated as mutation-capable until Owner establishes a trustworthy Effect and proof path.
4. Renamed the SAA stage to `skip-secondary-authentication` and fixed `required="0"` to match the plan. It is not described as an auth decision.
5. Removed the mandatory address-confirm stage for this fixed `LOCAL_POOL` profile.
6. Renamed the SSM stage to `signal-ue-and-access-network`; it owns the pending N1/N2-to-step-15 completion boundary. There is no extra callback or Wait Node.
7. Removed invented `resources.finalize` and `ca-compensate-confirmed-failure` Tool calls. Resource responsibility and exact-original compensation remain Host/Owner responsibilities.
8. Aligned charging with the pinned NW Agent behavior: the required s7 Operation succeeds with `charging_ref="1"` and `NOT_IMPL_skip`; the Skill verifies that skip disposition and continues to s8 without claiming a charging reservation.
9. Classified `SE.EMIT_EVENTS` as a local CA/MAS extension, not as a 3GPP notification.

## 3GPP and lifecycle deviations

- UECM registration occurs at s3r before PCF and N4, unlike the conventional TS 23.502 V19.9.0 §4.3.2.2.1 step 16c placement.
- The SAA step is always skipped by the current plan input. The six-case legacy suite's secondary-auth-required case is not covered.
- Charging is currently a successful `NOT_IMPL_skip` stub. This is part of the pinned NW Agent behavior and is not a blocker to functional equivalence with that source revision. Any future claim of actual charging requires a separately implemented and published charging capability; it must not be inferred from `charging_ref="1"`.
- The event record is local MAS state. Do not claim it is step 18.
- The step-3 ingress and paired step-5 early response are Host/SMF service-boundary concerns; the step-5 response is not final Goal proof.
- The later step-15 request completes the pending SSM Owner Operation in the same Invocation. The paired step-17 response remains a Host service-exit obligation after N4 Modification.
- N4 Establishment and N4 Modification are separate proof boundaries.

## Qualification gates

- Publish the exact MAS ToolCatalog and CapabilityContracts with the source-derived callable IDs, Effects, input/output Schemas, declared outcomes and Evidence Guarantees.
- Publish typed Owner output Schemas for the exact fields in the table; do not copy Owner schemas into Skill-owned files.
- Publish and test the Owner's exact mapping from the six-hex-digit `sNssai.sd` string to OES `s_nssai_sd`, including the plan's empty-string default when SD is absent.
- Replace every `urn:example:` Schema, ToolCatalog and Capability placeholder with trusted Owner exports.
- Verify Host initial `CreateSMContext` ingress authenticity, exact SUPI/PSI/lifecycle deduplication, and refusal to create a second independent invocation for a replayed original request. A Session shell does not establish business success; no generic SMF Session-absence Observation is required by this MAS Skill.
- Preserve the pinned s7 behavior: accept `charging_ref="1"` only as the source-defined successful skip marker, never as a real charging resource identity. A future charging implementation requires a new source/profile revision and new Owner contract.
- Publish Host/Owner correlation, Deadline, duplicate/late-result and paired step-17 response contracts for the pending SSM operation.
- Define Host-owned exact-original Reconcile semantics for `SC.COMPENSATE_RELEASE`; do not inherit `compensate_then_replan_once`.
- Revalidate all six legacy MAS Cases. Case 06 is currently unsupported by the fixed `secondary_auth_required='0'` plan.
- Run Compiler/link, Host/Runtime, MAS integration and live 5GC acceptance only after the publication gates close.

This file is a source-based migration record, not evidence that the MAS ToolCatalog, Runtime, charging, or live network path is qualified.

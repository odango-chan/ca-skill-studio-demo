---
name: establish-pdu-session-mas
description: CA-SL v1alpha5 illustrative OpenAMSM MAS policy-first initial PDU Session establishment source.
---

# Establish PDU Session — OpenAMSM MAS policy-first profile

**Source language:** [CA-SL v1alpha5](https://github.com/odango-chan/ca-skills/blob/0abfd0e1ab99f481a4ae01f3f47efc54783dd5e5/docs/skill-language-spec.v1alpha5.zh-CN.md).

**Adoption state: NOT_QUALIFIED / NOT_LINKABLE.** This is a source-aligned authoring example, not a linked, executable or Owner-approved Skill. The MAS ToolCatalog, operation Schemas, Evidence Guarantees and CapabilityContracts are not published. The `mas` dependency and all source-derived MAS IDs remain placeholders; Compiler linking must fail closed.

## Scope

One admitted initial IPv4 / SSC1, local non-roaming PDU Session request with `allocator=LOCAL_POOL` and no secondary authentication. This MAS Procedure **replaces the initial PDU Session establishment business flow**; it does not run after a separate successful Session creation. The Host authenticates and correlates the already-admitted initial `CreateSMContext` ingress, including duplicate suppression for its exact original invocation. AMF registration is an upstream ingress assumption, not a second network query authored by this Skill. No `cm_state=connected` gate is required. The first MAS Operation `SC.VALIDATE_SUBSCRIPTION` can cause the OpenAMSM `/invoke` resolver to materialize a session shell; neither that shell nor `sessionPresence=PRESENT` proves that establishment already succeeded. The Skill therefore does not use a separate SMF session-absence Observation as an admission predicate.

The Skill is deliberately a policy-first MAS compatibility profile. It is not the conventional 3GPP-first `establish-pdu-session` Skill and does not change that Skill's terminology or business flow.

## Source-aligned progression

The Procedure follows the imported OpenAMSM NW Agent plan:

1. SC `VALIDATE_SUBSCRIPTION`
2. SAA `SECONDARY_AUTH` with the plan's fixed `required="0"` (therefore `SKIPPED`)
3. SC `CREATE_SM_CONTEXT`
4. SC `REGISTER_UECM`
5. PA `CREATE_SM_POLICY`
6. UPS `DECIDE_ANCHOR`
7. IAM `ALLOCATE_ADDRESS` with `LOCAL_POOL`
8. PA `UPDATE_SM_POLICY`
9. CA `CREATE_CHARGING`
10. UPN `CREATE_UP_SESSION`
11. SSM `SIGNAL_UE_AN`
12. UPN `MODIFY_UP_SESSION`
13. SE `EMIT_EVENTS`

The optional IAM `CONFIRM_ADDRESS` step is omitted because this profile fixes `LOCAL_POOL`; it is relevant to the UPF allocator path. The OES `COMPENSATE_RELEASE` operation is not an authored Procedure Node. The OES plan's `compensate_then_replan_once` strategy is not copied into CA-SL: the Host/Owner may reconcile the exact original mutation only through its trusted `mutation.reconcile` boundary, and must never replan after `OUTCOME_UNKNOWN`.

## Important source facts

- The OES plan and OpenAMSM output contracts do not define `stateRef`. The Procedure uses the actual `sub_summary`, `session_keys`, `lifecycle`, `uecm_registered`, `policy_assoc_id`, `up_anchor`, `ue_addr`, `n4_seid`, `est_done`, `an_tunnel_teid`, `an_tunnel_ip`, `n3_synced` and `last_event` fields.
- `up_anchor` and `ue_addr` are `"1"/"0"` readiness/allocation markers. Neither is an anchor identifier or UE IP address. The selected PFCP node and actual allocated address remain inside SMF session state.
- `n4_seid` is a single UPF SEID, not an SMF/UPF N4 pair. `sm_context_ref` is an internal source reference and is not exposed as a 3GPP Location or Host correlation identity.
- `CA.CREATE_CHARGING` is a required NW Agent plan step. In the pinned source revision its adapter returns `SMF_MAS_OK`, outputs `charging_ref="1"` and records `NOT_IMPL_skip`; the next s8 step proceeds. The Skill verifies this exact step-completion disposition and does not claim that a charging reservation was created.
- `SE.EMIT_EVENTS` records a local MAS event and returns `last_event="1"`. It is not proof of TS 23.502 V19.9.0 §4.3.2.2.1 step-18 SM Context Status Notify.
- The MAS plan registers UECM before PCF/N4, earlier than the conventional TS 23.502 V19.9.0 §4.3.2.2.1 step-16c placement. This is a deliberate MAS ordering deviation.
- The plan hard-codes secondary authentication as not required. The legacy case requiring secondary authentication is not supported by this plan and remains an explicit migration gap.

The full source-by-source mapping, exact outputs, candidate callable identities and qualification gates are in [OpenAMSM Operation Mapping](references/openamsm-operation-mapping.md).

## Host and asynchronous boundary

The incoming TS 23.502 V19.9.0 §4.3.2.2.1 step-3 CreateSMContext Request (Nsmf API: TS 29.502 V19.7.0 §5.2/§6.1, OpenAPI Annex A.2) supplies the 3GPP `supi` and `pduSessionId` used by the Skill. Host performs trusted ingress authentication, initial-request classification, duplicate suppression and private lifecycle/Invocation correlation before this graph starts; it does not generate a UE identity alias or call AMF again to decide this Skill's eligibility.

The SSM `SIGNAL_UE_AN` Owner Operation sends the Step 11 `Namf_Communication_N1N2MessageTransfer` (TS 29.518 V19.8.0 §5.2, OpenAPI Annex A.2) and may remain pending until the later Step 15 `Nsmf_PDUSession_UpdateSMContext Request` (TS 29.502 V19.7.0 §5.2/§6.1, OpenAPI Annex A.2) supplies the access-network result/F-TEID. Host correlates that exact request to the pending Operation and Runtime resumes this same Invocation. It is not a new Skill invocation and does not require a Skill Wait/Await/Poll Node. The paired step-17 response remains a Host service-exit obligation after N4 Modification and the Procedure's terminal business outcome.

The Host owns resource responsibility and exact-original reconciliation. There is no authored `resources.finalize` or compensation Tool in this Procedure.

## 3GPP classification

The MAS graph is a CA policy-first implementation profile, not a normative 3GPP procedure. The following are adapter/extension boundaries:

- SC subscription validation wraps the UDM SDM Get path.
- SC context creation is associated with the step-3/step-5 service boundary; the early response is not final Goal proof.
- SC UECM registration is intentionally earlier than standard step 16c.
- PA policy create/update wrap PCF interactions.
- UPS/IAM selection and allocation are SMF-local CA adapters.
- UPN Create/Modify own separate N4 Session Establishment and Modification proof boundaries.
- SSM owns the N1/N2-to-step-15 completion result.
- CA charging and SE event recording are MAS-specific extensions, not standard 3GPP operations.

## 3GPP Traceability

**Pinned 3GPP baseline (checked 2026-11-17):** TS 23.502 V19.9.0 (Release 19), §4.3.2.2.1; TS 23.501 V19.9.0; TS 23.503 V19.8.0; Stage 3: TS 29.502 V19.7.0, TS 29.500 V19.7.1, TS 29.571 V19.7.0, TS 29.503 V19.7.0, TS 29.512 V19.6.0, TS 29.518 V19.8.0 and TS 29.244 V19.6.0. Versions are independently pinned per specification. This table records the 3GPP interactions supported or adapted by the MAS source plan; it does not make the MAS sequence a normative 3GPP procedure. The authoritative OES operation/input/output mapping is in [OpenAMSM Operation Mapping](references/openamsm-operation-mapping.md).

| Procedure Node | NW Agent / OES source | 3GPP interaction and classification |
|---|---|---|
| `validate-sm-subscription` | TS 23.502 V19.9.0 §4.3.2.2.1 step 4; UDM API TS 29.503 V19.7.0 §6.1 / OpenAPI Annex A.2 — s1 `SC.VALIDATE_SUBSCRIPTION` | `CA_ADAPTER` — wraps UDM `Nudm_SDM_Get`; its MAS `/invoke` resolver may materialize an SMF Session shell. Treat the candidate as potentially mutating until Owner proves its Effect and publishes trusted evidence. No standalone Session ABSENT gate. |
| `skip-secondary-authentication` | TS 23.502 V19.9.0 §4.3.2.2.1 step 6 (optional); s2 — `SAA.SECONDARY_AUTH`, fixed `required=0` | `CA_ADAPTER` — source-plan skip only; no secondary-authentication exchange is executed. |
| `create-sm-context` | TS 23.502 V19.9.0 §4.3.2.2.1 steps 3/5; Nsmf API TS 29.502 V19.7.0 §5.2/§6.1/§6.1.2.4 / OpenAPI Annex A.2; TS 29.571 V19.7.0 §5.4.4.14 — s3 `SC.CREATE_SM_CONTEXT` | `CA_ADAPTER` — SM Context creation at the Step 3/5 service boundary; the early Step 5 response is not final Goal proof. |
| `register-uecm` | TS 23.502 V19.9.0 §4.3.2.2.1 step 16c; UDM API TS 29.503 V19.7.0 §6.2 / OpenAPI Annex A.3 — s3r `SC.REGISTER_UECM` | `3GPP_NATIVE` — UDM `Nudm_UECM_Registration`; MAS ordering is earlier than conventional Step 16c. |
| `establish-sm-policy-association` | TS 23.502 V19.9.0 §4.3.2.2.1 step 7b; PCF API TS 29.512 V19.6.0 / OpenAPI Annex A.2 — s3p `PA.CREATE_SM_POLICY` | `3GPP_NATIVE` — PCF `Npcf_SMPolicyControl_Create`. |
| `select-upf-anchor` | TS 23.502 V19.9.0 §4.3.2.2.1 step 8 — s4 `UPS.DECIDE_ANCHOR` | `CA_ADAPTER` — SMF-local UPF selection; selected PFCP node remains internal. |
| `allocate-pdu-session-address` | TS 23.502 V19.9.0 §4.3.2.2.1 step 8 — s5 `IAM.ALLOCATE_ADDRESS`, `LOCAL_POOL` | `CA_ADAPTER` — SMF-local address allocation; the source marker is not the UE IP address. |
| `modify-sm-policy-association` | TS 23.502 V19.9.0 §4.3.2.2.1 step 9 (conditional); PCF API TS 29.512 V19.6.0 / OpenAPI Annex A.2 — s6u `PA.UPDATE_SM_POLICY` | `3GPP_NATIVE` — PCF `Npcf_SMPolicyControl_Update`. |
| `execute-charging-step` | s7 — `CA.CREATE_CHARGING` | `CA_EXTENSION` — MAS-specific charging extension; current source is a stub, not a 3GPP charging operation. |
| `establish-n4-session` | TS 23.502 V19.9.0 §4.3.2.2.1 steps 10a–10b and §4.4.1.2; PFCP/N4 TS 29.244 V19.6.0 — s8 `UPN.CREATE_UP_SESSION` | `3GPP_NATIVE` — N4 Session Establishment. |
| `signal-ue-and-access-network` | TS 23.502 V19.9.0 §4.3.2.2.1 steps 11 and 15; TS 29.518 V19.8.0 §5.2 / §6.1.2.4 / OpenAPI Annex A.2; TS 29.502 V19.7.0 §5.2/§6.1/§6.1.2.4 / OpenAPI Annex A.2; TS 29.571 V19.7.0 §5.4.4.14 — s10 `SSM.SIGNAL_UE_AN` | `CA_ADAPTER` — orchestrates AMF N1/N2 transfer and the pending UpdateSMContext completion. |
| `modify-n4-session` | TS 23.502 V19.9.0 §4.3.2.2.1 steps 16a–16b and §4.4.1.3; PFCP/N4 TS 29.244 V19.6.0 — s11 `UPN.MODIFY_UP_SESSION` | `3GPP_NATIVE` — N4 Session Modification. |
| `record-session-establishment-event` | TS 23.502 V19.9.0 §4.3.2.2.1 step 18 (conditional failure notification) — s13 `SE.EMIT_EVENTS` | `CA_EXTENSION` — local MAS event only; not the standard SM Context Status Notify operation. |
| `verify-pdu-session-establishment` | Final aggregate over MAS Owner Results | `CA_EXTENSION` — final business Goal proof; no direct 3GPP operation. |

## Binary N1/N2 payloads

The MAS adapter boundary uses the same Release 19 SBI payload contract as the conventional profile. TS 29.502 V19.7.0 §6.1.2.4 and TS 29.518 V19.8.0 §6.1.2.4 define `multipart/related` representations for Nsmf/Namf operations. N1 SM and N2 NGAP bytes are separate binary body parts, with media types `application/vnd.3gpp.5gnas` and `application/vnd.3gpp.ngap`. TS 29.571 V19.7.0 §5.4.4.14 defines `RefToBinaryData.contentId` as the matching binary part's `Content-ID` header value. The Owner/HTTP adapter owns multipart framing and the mapping between JSON references and binary bytes; the MAS Skill does not build raw HTTP multipart requests.

## Qualification blockers

1. MAS Owner ToolCatalog, exact callable IDs, input/output Schemas and CapabilityContracts are unpublished.
2. The Skill request Schema now represents `sNssai.sd` as the 3GPP six-hex-digit string, matching the OES input type. The MAS Owner must still publish and test the exact `sNssai.sd → s_nssai_sd` mapping and the plan's absent-value default.
3. MAS Operation Evidence Guarantees and source-to-Host Scope/Correlation contracts are unpublished.
4. Charging is a source-confirmed stub. The `"1"` marker and the corresponding skip Evidence attest only to completion of the skipped plan step.
5. The SAA path is hard-coded to skip; auth-required legacy case 06 is unsupported.
6. Host/Integration must demonstrate authenticated initial `CreateSMContext` admission and exact original-invocation deduplication; no duplicate AMF registration or CM-connected lookup is part of this Skill.
7. Host/Owner pending SSM continuation, duplicate/late result, Deadline and paired step-17 response contracts are not qualified.
8. Host-owned exact-original reconciliation for `SC.COMPENSATE_RELEASE` is not published.

The six legacy MAS Cases remain migration expectations, not executed v1alpha5 fixtures. Do not describe this Skill as runnable, linked, or qualified until all applicable gates close.

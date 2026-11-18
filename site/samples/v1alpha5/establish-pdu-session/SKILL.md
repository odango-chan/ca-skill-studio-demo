---
name: establish-pdu-session
description: CA-SL v1alpha5 illustrative conventional 5GC / UE-requested initial PDU Session establishment source.
---

# Establish PDU Session — 5GC

**Source language:** [CA-SL v1alpha5](https://github.com/odango-chan/ca-skills/blob/0abfd0e1ab99f481a4ae01f3f47efc54783dd5e5/docs/skill-language-spec.v1alpha5.zh-CN.md).

**Adoption state: NOT_QUALIFIED.** Linking this authoring example requires trusted Owner ToolCatalog and CapabilityContracts v1alpha4 exports, which CA-SL v1alpha5 inherits, and the companion IngressCatalog v1alpha1 export. All `urn:example:` identities and Evidence guarantees are illustrative.

## Scope and successful progression

One admitted, initial IPv4 / SSC1, local non-roaming PDU Session request with no secondary-authentication requirement. The supported success profile also requires that the PCF Create result has no Step 9 SM Policy Association Modification trigger. It excludes emergency and existing-session requests, home-routed roaming, IPv6/IPv4v6, and the Step 20 Bridge/Router trigger. Step 4 models the Get/Subscribe path on the assumption that matching Session Management Subscription data is not already available. Host/Owner binds the UE, PSI, Invocation lifecycle, resources and late callbacks to the exact admitted instance; none of those execution identities is Skill-authored context.

The normal path is:

1. Step 4 — UDM Session Management Subscription Get, then Subscribe.
2. Step 7b — PCF SM Policy Association Create.
3. Step 8 and steps 10a–10b — SMF UPF/session-address selection and N4 Session Establishment.
4. Step 11 — AMF N1/N2 Message Transfer.
5. Step 15 — the exact inbound Nsmf_PDUSession_UpdateSMContext Request is admitted by the version-pinned Integration Ingress Operation and accepted by the Node-entry Wait on `update-sm-context` in the same Run.
6. Steps 16a–16b — N4 Session Modification.
7. Step 16c — ensure the per-SUPI/PSI UDM UECM registration.
8. Step 17 — the `prepare-step17-response` Observation produces the typed paired-response DTO at the declared response boundary; Integration emits the response for that exact accepted request.

The Skill keeps the business decisions visible:

- Step 4 Postconditions verify the UDM response and whether the requested DNN, S-NSSAI, PDU Session Type and SSC Mode are allowed by the subscription. The compatibility check is a Predicate Script inside the Step 4 Postcondition, not a separate Procedure Node.
- The Step 7b PCF Create Owner consumes the validated UDM read result and request. It resolves the exact SDM subscription internally, checks the Step 6 secondary-authentication profile before dispatch, and returns normalized policy data. Association handles remain Owner-private.
- This profile admits only the Step 6 no-secondary-authentication case. If the DNN requires secondary authentication, the PCF Owner must reject before the Step 7b Create dispatch; the Skill does not attempt the DN-AAA exchange.
- Step 9 is omitted only for the explicitly constrained no-trigger profile. The PCF Owner result must attest `step9ModificationRequired == false`; if a trigger is present, this Skill must stop safely rather than silently skipping Step 9.
- The SMF N4 Owner performs native Step 8 UPF/session-address selection and N4 Session Establishment as one business interaction. Its normalized result carries the allocated IPv4 address, selected PDU Session Type/SSC Mode, DNN/SST, N4 resource readiness and a session-configuration digest. The AMF N1/N2 Tool consumes that exact result and its Evidence binds the transferred payload to the same digest.
- The Step 4 `get-sm-subscription-data` Node performs the read-only UDM `Nudm_SDM_Get` Operation, then a supplementary exact UE/PSI SM Context Observation in the same Node before its Postcondition. This is before the first session-creating or session-mutating Operation. `404 SESSION_NOT_FOUND` is normalized into a typed `ABSENT` result; `200 AVAILABLE` and `200 UNAVAILABLE` both mean `PRESENT`. Only explicit evidenced `ABSENT` selects initial creation. `PRESENT` does not fall through to the initial mutation chain.
- The Step 15 `update-sm-context` Node begins with a Node-entry Wait for the exact `AMF / Nsmf_PDUSession / UpdateSMContext` event. The normalized request is available only as `update-sm-context.wait.output` after EVENT_ACCEPTED. The following Operation consumes that exact request, then a fresh SMF session-context Observation runs in the same Node before its Postcondition. The entry lookup is not reused as a stale snapshot.
- Step 16c is represented by `ensure-uecm-registration`. Under this non-emergency initial-request profile, the UDM Owner checks whether the exact PDU Session is already registered: it performs `Nudm_UECM_Registration` only when needed and returns `ALREADY_REGISTERED` when the exact registration is already current. The SMF instance identity and UDM transaction handles remain Owner-private.

## Tool and Owner boundary

The SMF Operations use the illustrative callable identities `smf::n4.session.establish`, `ca::smf.session.update_from_amf` and `smf::n4.session.modify`.

Owner-specific handles remain private: UDM transaction/invocation refs, SDM subscription refs, PCF association/policy refs, N1/N2 transfer-operation refs, holds, claims, waiter refs, response-artifact refs and journal refs are not Skill arguments. The responsible Owner resolves these from trusted Invocation and business-instance state. The Skill passes only the SUPI, request and typed business results needed by the next 3GPP action.

The Skill does not expose Host/Runtime/Integration plumbing. Host admission, exact event correlation, delivery deduplication, Run persistence/resumption, cancellation, deadline enforcement and private response-obligation handles remain outside Skill source. The preceding Step 11 `transfer-n1n2-message` Operation is the declared trigger for the `update-sm-context` Wait. The Wait yields only the normalized request as `update-sm-context.wait.output`; it does not expose deliveryRef, expectedIngressRef, responseObligationRef, transferOperationRef or lifecycle metadata. `wait.response.after: prepare-step17-response` declares the Step 17 paired-response boundary after all applicable Step 16 work.

## Failure handling scope

This example deliberately prioritizes the complete successful path. Detailed failure-only cleanup is documented here rather than expanded into dedicated business Nodes:

- A definitive failure after resource creation routes to `SAFE_STOPPED`; an indeterminate mutation remains safely stopped with its original responsibility retained.
- If the authored Step 15 Wait deadline wins, the Run routes directly to `SAFE_STOPPED` and Host/Runtime retains responsibility for the already-dispatched Step 11 transfer.
- The paired Step 17 reject response, Step 18 `Nsmf_PDUSession_SMContextStatusNotify (Release)`, release of any created N4 sessions, allocated PDU Session address and PCF association remain Host/Owner responsibilities when the standard's failure trigger applies. Step 21 `Nudm_SDM_Unsubscribe` applies only after failure following Step 4 and only if the SMF no longer handles another PDU Session for the same SUPI, DNN and HPLMN S-NSSAI.
- The comments and stop routes do not claim that any of those cleanup actions have already completed. A future failure-path profile must add its own authoritative Owner Results/Evidence before it may publish a definitive `FAILED` terminal.
- Host/Runtime performs the terminal resource-responsibility finalizer before it publishes `SUCCEEDED`. This is a §12.8 terminal publish gate, not a Skill-authored Operation or Node.

## Host invocation boundary

The incoming TS 23.502 V19.9.0 §4.3.2.2.1 step 3 `Nsmf_PDUSession_CreateSMContext Request` is the Host ingress trigger, not an authored Procedure Node. The paired early Step 5 response is the same Nsmf service boundary, defined by TS 29.502 V19.7.0 §5.2/§6.1/§6.1.2.4 and OpenAPI Annex A.2; it is not final Goal proof. Host performs source/action/identity admission, duplicate suppression, business-instance association, Invocation lifecycle and correlation before Skill execution.

The later TS 23.502 V19.9.0 §4.3.2.2.1 Step 15 `Nsmf_PDUSession_UpdateSMContext Request` is admitted and normalized by the exact trusted Integration Ingress Operation selected through the ordinary `integration` dependency. Its three-part selector is `AMF / Nsmf_PDUSession / UpdateSMContext`; the Ingress export must bind it to the preceding `transfer-n1n2-message` Operation and prove pre-dispatch correlation. Runtime accepts the event for the active Wait occurrence and resumes the same Run at `update-sm-context`; the normalized request becomes `update-sm-context.wait.output`. It is not a new Skill invocation and the graph does not restart at `start`.

The paired Step 17 response boundary is the completion of `prepare-step17-response`, after N4 Modification and conditional Step 16c registration. Its Observation returns the typed response DTO from the exact `wait.output` and the normalized Step 15 result. Integration maps that Producer to the pinned TS 29.502 response representation and emits it for the exact response obligation. The later final Goal Postcondition does not extend or reset the response deadline. The response-result Schema, Producer mapping and all early-failure dispositions remain illustrative until the trusted IngressCatalog export is published.

The Skill's global Contract Precondition validates only the admitted business request profile. It is not an ingress-eligibility or Host-lifecycle check. The first Procedure Node is `get-sm-subscription-data`, whose Precondition validates the request profile, whose primary Operation is Step 4 `Nudm_SDM_Get`, and whose supplementary Observation checks exact UE/PSI context presence before the first mutation.

## 3GPP Traceability — SMF view

**Pinned 3GPP baseline (checked 2026-11-17):** TS 23.502 V19.9.0 (Release 19), §4.3.2.2.1; TS 23.501 V19.9.0; TS 23.503 V19.8.0; Stage 3: TS 29.502 V19.7.0, TS 29.500 V19.7.1, TS 29.571 V19.7.0, TS 29.503 V19.7.0, TS 29.512 V19.6.0, TS 29.518 V19.8.0 and TS 29.244 V19.6.0. Versions are independently pinned per specification, not one shared `V19.x.0`. This table describes intended mapping, not Owner approval or product conformance.

| Procedure Node | 3GPP source / interaction | Classification and SMF responsibility |
|---|---|---|
| `get-sm-subscription-data` | TS 23.502 V19.9.0 §4.3.2.2.1 step 4 — `Nudm_SDM_Get`; UDM API TS 29.503 V19.7.0 §6.1 / OpenAPI Annex A.2; then exact UE/PSI SM Context presence read before any mutation | `3GPP_NATIVE` primary Operation with a supplementary `CA_EXTENSION` READ Observation in the same Node. |
| `subscribe-sm-data` | TS 23.502 V19.9.0 §4.3.2.2.1 step 4 — `Nudm_SDM_Subscribe`; UDM API TS 29.503 V19.7.0 §6.1 / OpenAPI Annex A.2 | `3GPP_NATIVE`: subscribe to Session Management Subscription updates; Owner binds the exact original request privately. |
| `establish-sm-policy-association` | TS 23.502 V19.9.0 §4.3.2.2.1 step 7b — `Npcf_SMPolicyControl_Create`; PCF API TS 29.512 V19.6.0 / OpenAPI Annex A.2 | `3GPP_NATIVE`: PCF Owner performs the Step 6 profile gate and returns normalized policy data plus association Evidence. |
| `establish-n4-session` | TS 23.502 V19.9.0 §4.3.2.2.1 step 8 and steps 10a–10b; §4.4.1.2 N4 Session Establishment; PFCP/N4 TS 29.244 V19.6.0 | `CA_ADAPTER`: SMF N4 Owner performs native selection and N4 establishment as one interaction; its result carries the effective configuration required by N1/N2. |
| `transfer-n1n2-message` | TS 23.502 V19.9.0 §4.3.2.2.1 step 11 — `Namf_Communication_N1N2MessageTransfer`; AMF API TS 29.518 V19.8.0 §5.2 / §6.1.2.4 / OpenAPI Annex A.2; common binary type TS 29.571 V19.7.0 §5.4.4.14 | `3GPP_NATIVE`: SMF transfers N1/N2 information to AMF; Evidence binds the payload to the N4 configuration digest. ACK does not prove RAN acceptance. |
| `update-sm-context` | TS 23.502 V19.9.0 §4.3.2.2.1 step 15 — `Nsmf_PDUSession_UpdateSMContext Request` (AMF → SMF); exact `AMF / Nsmf_PDUSession / UpdateSMContext` Ingress Operation selector; followed by a fresh SM Context read | Node-entry Wait accepts the normalized request as `update-sm-context.wait.output`, then the `CA_ADAPTER` Operation and supplementary `CA_EXTENSION` Observation execute in the same Node. The preceding Step 11 Operation is the declared trigger. |
| `modify-n4-session` | TS 23.502 V19.9.0 §4.3.2.2.1 steps 16a–16b; §4.4.1.3 N4 Session Modification; PFCP/N4 TS 29.244 V19.6.0 | `CA_ADAPTER`: SMF N4 Owner completes forwarding modification using the validated RAN result. |
| `ensure-uecm-registration` | TS 23.502 V19.9.0 §4.3.2.2.1 step 16c — `Nudm_UECM_Registration`; UDM API TS 29.503 V19.7.0 §6.2 / OpenAPI Annex A.3, when the exact PSI is not already registered | `3GPP_NATIVE`: UDM Owner ensures the per-SUPI/PSI registration and returns durable Evidence. |
| `prepare-step17-response` | TS 23.502 §4.3.2.2.1 step 17 — `Nsmf_PDUSession_UpdateSMContext Response` | `CA_ADAPTER`: Reads the typed response result at the paired response boundary after Step 16. |
| `verify-pdu-session-establishment` | final facts derived from steps 15–17 and Step 16c | `CA_EXTENSION`: final Goal proof over authoritative network and UDM registration facts. |

Step 6 secondary authentication is outside this fixed profile and must be rejected before Step 7b dispatch when required. Step 9 is omitted only when the PCF response has no applicable modification trigger. Step 18 applies to failure after Step 5 and releases any created N4 sessions, allocated PDU Session address and PCF association. Step 21 applies only after failure following Step 4 when the SMF no longer handles another PDU Session for the same SUPI/DNN/HPLMN S-NSSAI. Step 19 IPv6 Router Advertisement and Step 20 Bridge/Router policy modification are outside this IPv4-only profile.

**Binary N1/N2 payload boundary:** TS 29.502 V19.7.0 §6.1.2.4 and TS 29.518 V19.8.0 §6.1.2.4 define `multipart/related` representations for the Nsmf/Namf operations used by this flow. N1 SM bytes use `application/vnd.3gpp.5gnas`; N2 NGAP bytes use `application/vnd.3gpp.ngap`. The JSON `RefToBinaryData` value is not the bytes: TS 29.571 V19.7.0 §5.4.4.14 defines its required `contentId` as the `Content-ID` header value of the referenced binary body part. The Tool Owner/HTTP adapter owns MIME framing, JSON root part, binary body parts and Content-ID binding; the Skill passes typed payload data under the published Tool Schema and does not construct multipart requests.

**Resolved service entry/exit boundaries:** TS 23.502 V19.9.0 Step 3 `Nsmf_PDUSession_CreateSMContext Request` and its early Step 5 response belong to the Host service ingress/exit boundary; TS 29.502 V19.7.0 §5.2/§6.1/§6.1.2.4 and OpenAPI Annex A.2 define the Nsmf service API. Step 5 is not final Goal proof. Step 15 `Nsmf_PDUSession_UpdateSMContext Request` is admitted and normalized by the exact trusted Integration Ingress Operation and accepted by the active Node-entry Wait in the existing Run. Step 17 `Nsmf_PDUSession_UpdateSMContext Response` is emitted at the `prepare-step17-response` boundary after applicable Step 16 work; later Goal proof and cleanup do not delay it. Neither request nor response starts a new Skill invocation.

### Capability mapping

The following are illustrative IDs only; they are **not** published CapabilityContracts exports. Procedure Scripts and Runtime-internal coordination are deliberately absent.

| Capability placeholder | Standard / CA scope |
|---|---|
| `urn:example:connectionagent:capability:3gpp:nudm-sdm-get:v1` | UDM `Nudm_SDM_Get` |
| `urn:example:connectionagent:capability:3gpp:nudm-sdm-subscribe:v1` | UDM `Nudm_SDM_Subscribe` |
| `urn:example:connectionagent:capability:3gpp:npcf-sm-policy-control-create:v1` | PCF `Npcf_SMPolicyControl_Create` |
| `urn:example:connectionagent:capability:3gpp:n4-session-establishment:v1` | SMF N4 Session Establishment toward UPF |
| `urn:example:connectionagent:capability:3gpp:namf-communication-n1n2-transfer:v1` | AMF `Namf_Communication_N1N2MessageTransfer` |
| `urn:example:connectionagent:capability:3gpp:nsmf-pdu-session-update-sm-context:v1` | SMF handling of AMF `Nsmf_PDUSession_UpdateSMContext` |
| `urn:example:connectionagent:capability:ca:smf-step17-response-observation:v1` | Read of the typed Step 17 response result |
| `urn:example:connectionagent:capability:ca:smf-session-context-read:v1` | Read-only access to current SMF session context |
| `urn:example:connectionagent:capability:3gpp:n4-session-modification:v1` | SMF N4 Session Modification toward UPF |
| `urn:example:connectionagent:capability:3gpp:nudm-uecm-registration:v1` | UDM `Nudm_UECM_Registration` |

The exact IDs must be replaced only by matching trusted CapabilityContracts exports. Generic legacy grants such as `fivegc-session-mutation` are not sufficient evidence of narrow NF/service authorization.

## Runtime and evidence boundary

**No author-level Await/Poll loop, Hold, Claim, waiter, Journal or Reconcile.** The one Step 15 Wait is the v1alpha5 Node-entry event control, not a fifth business stage or a Wait-only Node. Host/Runtime/Integration still owns exact correlation, durable delivery admission, duplicate/late-event isolation, cancellation, deadline and private response-obligation lifecycle. The Procedure MUST NOT expose `holdRef`, `waiterRef`, `claimRef`, `journalRef`, `transferOperationRef`, `expectedIngressRef`, `deliveryRef`, `responseObligationRef`, `policyAssociationRef` or `subscriptionRef` as arguments or outputs. If the exact Ingress export or its triggering Operation binding cannot be trusted, linking must fail closed.

The PCF Create adapter internally derives its request from the exact UDM read result and subscription state, then verifies the exact held PCF request, pre-N4 baseline, lifecycle isolation, Step 6 profile gate and absence of a Step 9 trigger before continuing. Its association-owned Evidence binds the durable result to the exact Skill occurrence, UE/PSI and request; PCF input-readiness and governance intermediates are not separate Skill Predicates. The AMF N1/N2 adapter internally resolves the exact held request, validates delivery context and response artifact, and only then claims and dispatches.

The Step 15 `update-sm-context` Operation consumes the accepted normalized request and may report success only when its published contract and authoritative Result/Evidence prove the relevant SMF-side completion. An AMF transfer acknowledgement alone never proves RAN adoption or N4 forwarding readiness.

The two SMF context reads are supplementary Observation stages, not independent Procedure Nodes. The entry read is attached to `get-sm-subscription-data` after the read-only UDM Get and before the first mutation; the fresh post-Step-15 read is attached to `update-sm-context` after the accepted Wait and Operation, before its Postcondition. They serve different decisions and must not reuse one another's snapshot. Neither is callback polling. The generic callable, normalized result Schema, Capability, Evidence Descriptor and Scope/freshness contract remain unpublished, so both Observation-dependent PASS decisions remain NOT_QUALIFIED until those trusted publications exist.

**Known blockers:** missing exact v1alpha5 Owner/Capability publications for the UDM, PCF, AMF and SMF business Operations; checked output Schemas and Evidence descriptors; confirmed callable input identities; and Compiler/Studio/Host §45.2 execution evidence. Do **not** infer completion or production readiness from YAML syntax checks.

## Context ownership

The Skill receives the 3GPP SUPI from the admitted CreateSMContext request plus its own validated request. It does not receive ingressRef, lifecycleRef, instanceId, hold, waiter or journal metadata. Host ingress admission and business-instance correlation finish before this Procedure starts; the request-profile Predicate is a business gate, not a Host lifecycle check.

The Agent may request explicit read-only Observations for SMF-owned session context when a business decision requires facts not already present in an Operation Result/Evidence. In this conventional flow, both reads are co-located with the business Operation they support: the entry lookup follows the read-only Step 4 UDM Get and the fresh context read follows the accepted Step 15 Wait and `update-sm-context` Operation. They do not create standalone Observation Nodes, fan out across unrelated context projections or poll for a callback. The Agent does not directly query AMF, UDM, PCF or UPF context; the responsible Tool/Owner obtains and validates those facts internally. See the CA Agent Host 5GC context boundary: https://github.com/odango-chan/ca-agent-demo/blob/docs/5gc-agent-context-boundary-20261116/docs/design/5gc-agent-context-access-boundary-v1alpha5.md.

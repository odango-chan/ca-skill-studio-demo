---
name: establish-pdu-session
description: CA-SL v1alpha4 illustrative conventional 5GC / UE-requested initial PDU Session establishment source.
---

# Establish PDU Session — 5GC

**Source language:** CA-SL v1alpha4 (pinned normative specification `7f84393ee8c395e4d8c39a74cb5000a1f896588d`).

**Adoption state: NOT_QUALIFIED.** This is an authoring and editor example, not yet linked to trusted v1alpha4 ToolCatalog and CapabilityContracts publications. All `urn:example:` identities and Evidence guarantees are illustrative. The Compiler must fail closed until exact Owner exports, Schema identities and trust bindings are published.

## Scope and successful progression

One admitted, initial IPv4 / SSC1, local non-roaming PDU Session request with no secondary-authentication requirement. The supported success profile also requires that the PCF Create result has no Step 9 SM Policy Association Modification trigger. Host/Owner binds the UE, PSI, Invocation lifecycle, resources and late callbacks to the exact admitted instance; none of those execution identities is Skill-authored context.

The normal path is:

1. Step 4 — UDM Session Management Subscription Get, then Subscribe.
2. Step 7b — PCF SM Policy Association Create.
3. Step 8 and steps 10a–10b — SMF UPF/session-address selection and N4 Session Establishment.
4. Step 11 — AMF N1/N2 Message Transfer.
5. Step 15 — the later inbound Nsmf_PDUSession_UpdateSMContext Request completes the pending SMF Operation in the same Invocation.
6. Steps 16a–16b — N4 Session Modification.
7. Step 16c — ensure the per-SUPI/PSI UDM UECM registration.
8. Step 17 — Host emits the paired Nsmf_PDUSession_UpdateSMContext Response for the exact inbound request.

The Skill keeps the business decisions visible:

- Step 4 Postconditions verify the UDM response and whether the requested DNN, S-NSSAI, PDU Session Type and SSC Mode are allowed by the subscription. The compatibility check is a Predicate Script inside the Step 4 Postcondition, not a separate Procedure Node.
- The Step 7b PCF Create Owner consumes the validated UDM read result and request. It resolves the exact SDM subscription internally, checks the Step 6 secondary-authentication profile before dispatch, and returns normalized policy data. Association handles remain Owner-private.
- This profile admits only the Step 6 no-secondary-authentication case. If the DNN requires secondary authentication, the PCF Owner must reject before the Step 7b Create dispatch; the Skill does not attempt the DN-AAA exchange.
- Step 9 is omitted only for the explicitly constrained no-trigger profile. The PCF Owner result must attest `step9ModificationRequired == false`; if a trigger is present, this Skill must stop safely rather than silently skipping Step 9.
- The SMF N4 Owner performs native Step 8 UPF/session-address selection and N4 Session Establishment as one business interaction. Its normalized result carries the allocated IPv4 address, selected PDU Session Type/SSC Mode, DNN/SST, N4 resource readiness and a session-configuration digest. The AMF N1/N2 Tool consumes that exact result and its Evidence binds the transferred payload to the same digest.
- The Step 4 `get-sm-subscription-data` Node performs the read-only UDM `Nudm_SDM_Get` Operation, then a supplementary exact UE/PSI SM Context Observation in the same Node before its Postcondition. This is before the first session-creating or session-mutating Operation. `404 SESSION_NOT_FOUND` is normalized into a typed `ABSENT` result; `200 AVAILABLE` and `200 UNAVAILABLE` both mean `PRESENT`. Only explicit evidenced `ABSENT` selects initial creation. `PRESENT` does not fall through to the initial mutation chain.
- The Step 15 `update-sm-context` Node completes the pending SMF UpdateSMContext Operation, then performs a fresh, read-only SMF session-context Observation in the same Node before its Postcondition. This validates the current DNN/SST, subscription-validation, secondary-authentication and UECM-registration facts for the Step 16 decisions. The entry lookup is not reused as a stale snapshot.
- Step 16c is represented by `ensure-uecm-registration`. The UDM Owner checks the exact current `uecmRegistered` fact: it performs `Nudm_UECM_Registration` when needed and returns `ALREADY_REGISTERED` when the exact registration is already current. The SMF instance identity and UDM transaction handles remain Owner-private.

## Tool and Owner boundary

The Skill-facing callable identities are business/NF-oriented: `smf::n4.session.establish`, `smf::nsmf.pdu_session.update_sm_context` and `smf::n4.session.modify`. The Skill does not expose internal SMF module names.

Owner-specific handles remain private: UDM transaction/invocation refs, SDM subscription refs, PCF association/policy refs, N1/N2 transfer-operation refs, holds, claims, waiter refs, response-artifact refs and journal refs are not Skill arguments. The responsible Owner resolves these from trusted Invocation and business-instance state. The Skill passes only the SUPI, request and typed business results needed by the next 3GPP action.

The Skill does not expose Host/Runtime plumbing. Hold binding, Claim, callback correlation, Journal, exact-original Reconcile, PCF request preparation/governance, operation-context lookup, N1/N2 response-artifact preparation and the deferred Step 17 SBI response obligation are internal to Host/Owner adapters. The Step 15 Owner Operation may remain pending for the exact inbound request under the v1alpha4 model; this is not an author-level Wait. Runtime resumes the same Invocation after the Operation returns.

## Failure handling scope

This example deliberately prioritizes the complete successful path. Detailed failure-only cleanup is documented here rather than expanded into dedicated business Nodes:

- A definitive failure after resource creation routes to `SAFE_STOPPED`; an indeterminate mutation remains safely stopped with its original responsibility retained.
- The paired Step 17 reject response, Step 18 SM Context Status Notify, N4 release, PCF Association release, UDM SDM Unsubscribe and the conditional Step 21 cleanup remain Host/Owner responsibilities.
- The comments and stop routes do not claim that any of those cleanup actions have already completed. A future failure-path profile must add its own authoritative Owner Results/Evidence before it may publish a definitive `FAILED` terminal.
- Host/Runtime performs the terminal resource-responsibility finalizer before it publishes `SUCCEEDED`. This is a §12.8 terminal publish gate, not a Skill-authored Operation or Node.

## Host invocation boundary

The incoming TS 23.502 §4.3.2.2.1 step 3 CreateSMContext Request is the Host ingress trigger, not an authored Procedure Node. Host performs source/action/identity admission, duplicate suppression, business-instance association, Invocation lifecycle and correlation before Skill execution.

The later Step 15 Nsmf_PDUSession_UpdateSMContext Request is not a new Skill invocation. Host admits it and correlates it to the exact pending `update-sm-context` Owner Operation using trusted UE/PSI/HostBusinessInstance and transfer-operation association. This correlation is private; no response handle, transferOperationRef, ingressRef or lifecycleRef is exposed to Skill source. Runtime resumes the same Invocation at the pending Node; the graph does not restart at `start`.

Host retains the exact Step 15 request/response transport obligation privately. After the Procedure has completed N4 Modification, Step 16c and the final business Postcondition, Host emits the paired Step 17 Nsmf_PDUSession_UpdateSMContext Response for that exact request. The normal-success response mapping must be published and tested by the Host/Owner before live qualification.

The Skill's global Contract Precondition validates only the admitted business request profile. It is not an ingress-eligibility or Host-lifecycle check. The first Procedure Node is `get-sm-subscription-data`, whose Precondition validates the request profile, whose primary Operation is Step 4 `Nudm_SDM_Get`, and whose supplementary Observation checks exact UE/PSI context presence before the first mutation.

## 3GPP Traceability — SMF view

**Pinned reference:** 3GPP TS 23.502 V18.12.0 (Release 18), §4.3.2.2.1; N4 procedures §4.4.1.2–§4.4.1.3. This table describes intended mapping, not Owner approval or product conformance.

| Procedure Node | 3GPP source / interaction | Classification and SMF responsibility |
|---|---|---|
| `get-sm-subscription-data` | step 4 — `Nudm_SDM_Get`; then exact UE/PSI SM Context presence read before any mutation | `3GPP_NATIVE` primary Operation with a supplementary `CA_EXTENSION` READ Observation in the same Node. |
| `subscribe-sm-data` | step 4 — `Nudm_SDM_Subscribe` | `3GPP_NATIVE`: subscribe to Session Management Subscription updates; Owner binds the exact original request privately. |
| `establish-sm-policy-association` | step 7b — `Npcf_SMPolicyControl_Create` | `3GPP_NATIVE`: PCF Owner performs the Step 6 profile gate and returns normalized policy data plus association Evidence. |
| `establish-n4-session` | step 8 native SMF session/UPF selection, then steps 10a–10b; §4.4.1.2 N4 Session Establishment | `CA_ADAPTER`: SMF N4 Owner performs selection and N4 establishment as one interaction; its result carries the effective configuration required by N1/N2. |
| `transfer-n1n2-message` | step 11 — `Namf_Communication_N1N2MessageTransfer` | `3GPP_NATIVE`: SMF transfers N1/N2 information to AMF; Evidence binds the payload to the N4 configuration digest. ACK does not prove RAN acceptance. |
| `update-sm-context` | step 15 — `Nsmf_PDUSession_UpdateSMContext Request` (AMF → SMF); followed by a fresh SM Context read | `CA_ADAPTER` primary Operation plus supplementary `CA_EXTENSION` READ Observation in the same Node. Host correlates the exact inbound request; Runtime resumes the same Invocation. |
| `modify-n4-session` | steps 16a–16b; §4.4.1.3 N4 Session Modification | `CA_ADAPTER`: SMF N4 Owner completes forwarding modification using the validated RAN result. |
| `ensure-uecm-registration` | step 16c — `Nudm_UECM_Registration`, when the exact PSI is not already registered | `3GPP_NATIVE`: UDM Owner ensures the per-SUPI/PSI registration and returns durable Evidence. |
| `verify-pdu-session-establishment` | final facts derived from steps 15–17 and Step 16c | `CA_EXTENSION`: final Goal proof over authoritative network and UDM registration facts. |

Step 6 secondary authentication is outside this fixed profile and must be rejected before Step 7b dispatch when required. Step 9 is omitted only when the PCF response has no applicable modification trigger. Step 18 and Step 21 are failure-path cleanup responsibilities documented above, not silently successful steps. Step 20 and IPv6 Router Advertisement handling are outside this IPv4-only profile.

**Resolved service entry/exit boundaries:** Step 3 `Nsmf_PDUSession_CreateSMContext Request` and its early Step 5 response belong to the Host service ingress/exit boundary; Step 5 is not final Goal proof. Step 15 `Nsmf_PDUSession_UpdateSMContext Request` is admitted by Host and correlated to the pending `update-sm-context` Operation in the existing Invocation. Step 17 `Nsmf_PDUSession_UpdateSMContext Response` is the paired Host service exit for that exact request, emitted after the Procedure reaches its terminal business outcome. Neither response is a new Skill Node or a new Skill invocation.

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
| `urn:example:connectionagent:capability:ca:smf-session-context-read:v1` | Read-only access to current SMF session context |
| `urn:example:connectionagent:capability:3gpp:n4-session-modification:v1` | SMF N4 Session Modification toward UPF |
| `urn:example:connectionagent:capability:3gpp:nudm-uecm-registration:v1` | UDM `Nudm_UECM_Registration` |

The exact IDs must be replaced only by matching trusted CapabilityContracts exports. Generic legacy grants such as `fivegc-session-mutation` are not sufficient evidence of narrow NF/service authorization.

## Runtime and evidence boundary

**No author-level Wait/Await/Poll, Hold, Claim, waiter, Journal or Reconcile.** These are Host/Runtime/Owner-adapter responsibilities, not Skill business steps. The Procedure MUST NOT expose `holdRef`, `waiterRef`, `claimRef`, `journalRef`, `transferOperationRef`, `policyAssociationRef` or `subscriptionRef` as arguments or outputs. The responsible adapter resolves exact correlation from trusted Invocation Context and Owner state, preserves UE/Session/ingress/lifecycle/current-instance binding, claims once, sends once, records the original operation and reconciles only that exact operation. If the Owner cannot prove these guarantees, linking must fail closed.

The PCF Create adapter internally derives its request from the exact UDM read result and subscription state, then verifies the exact held PCF request, pre-N4 baseline, lifecycle isolation, Step 6 profile gate and absence of a Step 9 trigger before continuing. Its association-owned Evidence binds the durable result to the exact Skill occurrence, UE/PSI and request; PCF input-readiness and governance intermediates are not separate Skill Predicates. The AMF N1/N2 adapter internally resolves the exact held request, validates delivery context and response artifact, and only then claims and dispatches.

The SMF UpdateSMContext Owner handles the exact asynchronous Step 15 completion. Host correlates the later inbound request to the pending Operation and Runtime resumes the same Invocation; the Operation may report success only when its published contract and authoritative Result/Evidence prove the relevant SMF-side completion. An AMF transfer acknowledgement alone never proves RAN adoption or N4 forwarding readiness.

The two SMF context reads are supplementary Observation stages, not independent Procedure Nodes. The entry read is attached to `get-sm-subscription-data` after the read-only UDM Get and before the first mutation; the fresh post-Step-15 read is attached to `update-sm-context` after the pending Operation completes and before its Postcondition. They serve different decisions and must not reuse one another's snapshot. Neither is callback polling. The generic callable, normalized result Schema, Capability, Evidence Descriptor and Scope/freshness contract remain unpublished, so both Observation-dependent PASS decisions remain NOT_QUALIFIED until those trusted publications exist.

**Known blockers:** missing exact v1alpha4 Owner/Capability publications for the UDM, PCF, AMF and SMF business Operations; checked output Schemas and Evidence descriptors; confirmed callable input identities; and Compiler/Studio/Host §45.2 execution evidence. Do **not** infer completion or production readiness from YAML syntax checks.

## Context ownership

The Skill receives the 3GPP SUPI from the admitted CreateSMContext request plus its own validated request. It does not receive ingressRef, lifecycleRef, instanceId, hold, waiter or journal metadata. Host ingress admission and business-instance correlation finish before this Procedure starts; the request-profile Predicate is a business gate, not a Host lifecycle check.

The Agent may request explicit read-only Observations for SMF-owned session context when a business decision requires facts not already present in an Operation Result/Evidence. In this conventional flow, both reads are co-located with the business Operation they support: the entry lookup follows the read-only Step 4 UDM Get and the fresh context read follows completion of the Step 15 UpdateSMContext Operation. They do not create standalone Observation Nodes, fan out across unrelated context projections or poll for a callback. The Agent does not directly query AMF, UDM, PCF or UPF context; the responsible Tool/Owner obtains and validates those facts internally. See the CA Agent Host 5GC context boundary: https://github.com/odango-chan/ca-agent-demo/blob/docs/5gc-agent-context-boundary-20261116/docs/design/5gc-agent-context-access-boundary-v1alpha4.md.

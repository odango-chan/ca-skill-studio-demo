---
name: release-pdu-session-mas
description: CA-SL v1alpha5 UE-requested Release Procedure for the merged OpenAMSM Scheme C Owner transaction.
---

# Release PDU Session - OpenAMSM Scheme C MAS profile

**Source language:** CA-SL v1alpha5.

**Adoption state: OWNER_LINKED / DEVELOPMENT_STATIC_BUILD_PASS / PRODUCTION_NOT_QUALIFIED.** The `mas` dependency resolves to the published Owner package `urn:openamsm:mas:tool-contracts` v1alpha4. Its ToolCatalog, Scheme C callable input/output Schemas, mutation receipt and commit-proof Schemas, Evidence Guarantees, Owner identity and deployment CapabilityContracts are published. `ca-skills` PR #85 verified this Skill with released `skillc v2.0.2` in release mode against the Owner v1alpha4 publication, without a fixture Owner identity. This is static Compiler evidence only: it is not Production Admission, and the 2026-11-23 live Development E2E used the pre-PR #85 source revision. Re-run the live E2E against this exact Owner-linked revision before claiming current-source E2E.

## Scope

This Skill models a UE-requested release of an existing PDU Session. It does not
create a session and does not cover AMF-initiated ReleaseSMContext or
SMF/network-initiated release. The Host authenticates and classifies the ingress,
retains the exact original 5GSM PDU Session Release Request (0xd1) in its private
artifact binding, and binds the exact SUPI / PSI / current generation and a
Host-private release transaction. Neither the raw N1 nor the transaction id is a
Skill-authored request field; the typed Provider resolves them from that trusted
private context at dispatch time.

The Skill does not parse NAS, build NGAP, delete PFCP state itself, or expose
Host ResourceMap keys, Owner session references, invocation IDs, generation IDs
or transport correlation handles.

## Entry

Only `entryKind = UE_INITIATED` and the OpenAMSM numeric trigger 2 map to this
Procedure. AMF-initiated ReleaseSMContext and network-initiated release are
out of scope for this version and must be reported as NOT_RUN / BLOCKED by the
Host rather than coerced into this Skill.

The release transaction identity is Host-private state for this Run. It is never
taken from the AMF JSON body and never becomes a Procedure argument.

## Source progression (merged Owner)

1. `r-parse` - `SSM.PARSE_N1_RELEASE` with `parse_n1=1` and the exact retained
   N1. Read-only: validates EPD / PSI / PTI / message type and returns `psi`,
   `pti`, optional `cause` and `release_intent=ue_requested`. The parse is
   strictly read-only: it must not bind the PTI to the session.
2. `r-build` - `SSM.BUILD_RELEASE_COMMAND` with `release=1`, `mode=build`,
   `trigger` and the parsed `pti`. Build is the transaction-controlled PTI
   binding, and the typed Provider supplies the Host-private `release_txn`.
   The Owner builds the N1 Release Command (0xd3)
   and the N2 PDU Session Resource Release Command, records the release
   generation and returns their exact bytes as hex. The Host sends them to the
   AMF in the UpdateSMContext answer.
3. `r-confirm-n1` - `SSM.RELEASE_CONFIRM_N1` bound to the build transaction and
   generation. Only an exact N1 Release Complete (0xd4) is accepted; duplicates,
   late answers and old generations are rejected by the Owner.
4. `r-confirm-n2` - `SSM.RELEASE_CONFIRM_N2` bound to the same transaction and
   generation. N1 and N2 confirmations are independent and order-free; the
   Owner reports `release_ready=1` only after both were accepted.
5. `r-pa` - `PA.DELETE_SM_POLICY` terminates the policy association.
6. `r-upn` - `UPN.DELETE_UP_SESSION` performs the real PFCP Session Deletion
   (54/55).
7. `r6` - `SE.EMIT_EVENTS(ev=RELEASED)` writes the local release marker.
8. `r-sc` - `SC.RELEASE_SM_CONTEXT` with `release=1` and `finalize=1` releases
   the SM Context after the successful cleanup.

The older OES-shaped `r2`-`r6` sequence (UPN -> SSM -> PA -> SC -> SE) is not
this Owner transaction and is not used by this version.

## Continuation boundary

The two confirmations are separate SBI ingress events. The Host records each
exact event for this Run and re-executes the same Run; the Runtime defers the
confirmation occurrence until its event exists (INGRESS_WAIT), and replays the
already settled parse/build. A confirmation must never be fabricated from a
state string, and a duplicate or late answer must not dispatch the cleanup a
second time.

## Goal boundary

A successful Invocation proves that the Owner built the release command for this
Run's transaction, accepted both the N1 Release Complete and the N2 Release
Response for the same generation, and completed the cleanup (policy termination,
one PFCP Session Deletion, release event marker, SM Context finalize).

It does not prove that the AMF or UE observed the command, that PCF/UDM callbacks
were delivered, or that the user plane carried traffic. A PFCP UNKNOWN deletion
outcome, a failed finalize or a missing confirmation fails closed; the Skill
never reports an unconfirmed release as SUCCEEDED.

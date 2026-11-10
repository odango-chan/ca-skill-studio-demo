---
name: establish-pdu-session-mas
description: Fulfil an admitted UE-requested initial PDU Session Establishment using governed session-management capabilities backed by SMF MAS.
---

# Establish PDU Session through SMF MAS

## When to use

Use this Skill only for one clearly identified, admitted **initial UE-requested PDU
Session Establishment**. It does not itself execute a generic session
modification, release or Service Request activation.

The first candidate profile is a local, non-roaming IPv4 session with SSC mode
1, an explicit DNN and S-NSSAI, one default non-GBR flow, and **no required
secondary authentication**. The request, subscription and active deployment
facts must all support this profile. The absence of a secondary-authentication
requirement is not proof that any required no-auth handling has already occurred.

Do not reinterpret an unsupported request, invent missing identifiers or silently
select another profile. If the exact UE, PDU Session, request occurrence,
session identity or execution ownership cannot be established, stop rather than
guess.

## Business facts and progression

The admitted request must first be eligible for this establishment operation,
including the correct lifecycle, unique execution ownership and usable
subscription. A subscription validation result must establish that the requested
DNN, slice, session type and SSC mode are permitted. A protocol acknowledgement
or a summary without the relevant subscription restrictions is not sufficient.

For the MAS **policy-first** establishment profile, the important business
dependencies are:

- Create the correct SM context from the validated subscription and establish
  its exact resource identity. Required UE registration and secondary-auth
  disposition must be accounted for, even if a particular admitted profile may
  legitimately skip an optional operation.
- The initial policy association is created **before** user-plane anchor
  selection and address allocation. Once an address has been allocated, the
  policy must be updated using that actual address and the same policy
  association. The current authorized policy, QoS and user-plane intent are the
  *updated* values, not assumptions from the initial policy result.
- Select an authorized user-plane anchor, allocate and (when required) confirm
  the address, then establish charging and initial user-plane resources using
  the current authorized policy and the same session occurrence.
- Deliver the authorized UE/RAN setup and wait for the **SMF-adopted RAN
  result**, not merely a transfer acknowledgement. Activate downlink
  forwarding on the **same user-plane session instance** using the resulting
  access tunnel, and account for any required establishment notification.

Each step needs its actual producer and current-session evidence. Do not
substitute a request value for an observed allocated address; do not substitute
a previous policy result for an updated one; do not substitute an unrelated N4
SEID or a stale RAN tunnel for the current session.

The external MAS workflow is not permission to bypass the selected Skill's
admitted execution or to start a second, competing workflow for this session.

## What must be known

Before progressing beyond a stage, establish the relevant facts from the
available trusted capabilities and current evidence:

- The exact UE, request, ingress, lifecycle, SM context and session generation
  belong to this invocation.
- The subscription and resulting policy authorize the effective DNN, slice,
  session type, SSC mode, UE address, QoS and user-plane intent.
- The initial N4 resources exist for this session, and the RAN setup result has
  actually been adopted by the SMF.
- The final forwarding update belongs to those same resources and uses the
  current access tunnel.
- All created resources and possible late callbacks/results have a known,
  durable manager or a verifiable release record.

A successful action response is not itself proof of a business postcondition.
If authoritative evidence is missing, stale, from the wrong producer, or from
a different session generation, the business fact remains **UNKNOWN**.

## Completion

Completion requires all of the following for this exact establishment
occurrence:

1. The SMF has adopted the relevant RAN setup result.
2. Downlink forwarding is ready on the same user-plane session.
3. Resource and late-result responsibility has been durably accounted for.

These conditions must be independently verified. A model response or a network
success status alone cannot assert completion.

## Failure and uncertainty

An explicit, proven business rejection follows the admitted failure handling.
Only confirmed cleanup or a durable owner handoff can settle created-resource
responsibility. An external best-effort compensation response is not, by itself,
proof that every resource was released.

After an action may have been sent, timeout, disconnect, malformed response
or an ambiguous error must not be treated as proof that the action did not
commit. Preserve the **original** operation identity for reconciliation. Do not
blindly retry the mutation under a new identity or infer success from a late,
unrelated response.

When the state of a mutation or its resources cannot be established, stop
safely with responsibility preserved. A later continuation requires fresh
admission and authoritative state; it does not reuse a guessed outcome.

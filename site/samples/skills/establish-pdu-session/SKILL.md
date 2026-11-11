---
name: establish-pdu-session
description: Handle one admitted UE-requested initial PDU Session Establishment procedure and converge it to a verified network state.
---

# Establish PDU Session

## Purpose

Fulfil one admitted **UE-requested initial PDU Session Establishment** occurrence.

This Skill owns the session-management business progression for that occurrence. A
successful service call, protocol acknowledgement, forwarding-plane request or observed
mutation is never enough by itself to prove that the PDU Session Establishment procedure
is complete.

Use this Skill only for the exact admitted occurrence. Do not switch to another UE,
PDU Session, attempt, lifecycle, producer or "latest" state.

For deterministic execution, `assurance/procedure.yaml` remains the exact machine
workflow. When a model-driven route is enabled, this file provides business guidance;
do not reconstruct the deterministic graph as a second workflow.

## Supported profile

The current profile is intentionally narrow:

- local, non-roaming UE-requested establishment;
- Request Type = initial request;
- IPv4 PDU Session;
- SSC mode 1;
- one default non-GBR flow;
- no secondary PDU Session authentication/authorization with a DN-AAA server;
- no conditional SM Policy Association Modification branch unless a later profile adds it.

If the admitted request requires behavior outside this profile, do not silently skip the
missing branch and continue as though it had succeeded.

The occurrence carries the requested DNN, S-NSSAI, PDU Session Type and SSC mode together
with the exact PDU Session ID and PTI. Missing, stale, ambiguous or cross-occurrence
information is not a usable default.

Preserve the exact SSC mode list returned in `allowedSscModes`; do not truncate or deduplicate it during evaluation or selection. Open5GS may include the default in a three-mode list, while a standards-shaped subscription may list only additional modes. The default mode remains permitted even when it is absent from `allowedSscModes`. The supported request profile still requires SSC mode 1 and must prove that mode 1 is permitted by either the default or the additional-mode list. Read `references/session-selection.md` only if more detail is needed.

## Business progression

Keep the procedure recognizable as UE-requested PDU Session Establishment:

1. `Nudm_SDM_Get`;
2. subscription-constrained selection;
3. `Nudm_SDM_Subscribe`;
4. `Npcf_SMPolicyControl_Create`;
5. initial N4 Session Establishment convergence;
6. `Namf_Communication_N1N2MessageTransfer`;
7. PDU Session Resource Setup convergence;
8. N4 Session Modification / forwarding convergence;
9. resource-responsibility finalization.

This is business guidance, not a replacement execution graph. The model chooses the next
business decision from current trusted facts and permitted business actions.

## Optional business references

You may decide whether more domain knowledge would help the current business decision.
Read only a relevant file through an available read-only reference reader, if one is
provided. No reference is required at Skill activation:

- `references/3gpp-procedure.md` — 3GPP actors, message responsibilities and the
  distinction between initiating a transfer and network convergence.
- `references/session-selection.md` — DNN, S-NSSAI, PDU Session Type, SSC mode,
  subscription defaults and effective configuration decisions.
- `references/failure-handling.md` — business rejection, missing evidence,
  asynchronous waits, mutation uncertainty and resource responsibility.

These references supplement this guide. They are not live evidence, business actions,
or an alternative authority. Proceed without reading anything when the current guidance
and trusted facts suffice. Do not guess other paths or invent the contents of an
unavailable reference.

## Configuration layers

Keep these three layers distinct:

- **Requested Session Parameters** — what this admitted UE occurrence requested.
- **Subscription-Constrained Selection** — what subscription data permits and supplies as
  policy input.
- **Effective Session Configuration** — what is actually authorized, allocated and ready
  to deliver to UE/RAN.

No earlier layer proves a later one.

Subscription defaults must not silently override the admitted UE request. A successful
policy or allocation operation must not be treated as proof that downstream delivery or
network convergence has already happened.

## Admission and safe progression

Before progressing, the exact request occurrence must remain admitted for this supported
profile. The UE, PDU Session identity, attempt and lifecycle must remain consistent.
Every side effect requires authorization for that same occurrence.

These safety conditions are not a routine checklist to bypass or work around. If a
required condition is not established, stop safely rather than switching to another
action, identity or source of state.

## Business facts to establish

The following facts determine whether the business procedure may advance:

| Business fact | Meaning |
| --- | --- |
| Subscription is usable | Current subscription data permits the requested DNN, slice, session type and SSC mode |
| Subscription is durably owned | The required SDM subscription is owned for this occurrence |
| Policy association is durably owned | The required SM Policy Association belongs to this occurrence |
| Initial N4 resources are ready | Authoritative initial user-plane resources exist for the current session |
| AMF transfer was initiated | The exact N1/N2 transfer for this occurrence was initiated |
| RAN setup was accepted | The RAN accepted PDU Session Resource Setup for this occurrence |
| Forwarding is ready | Required downlink forwarding is ready on the same session instance |
| Resources are managed | Created resources and possible late results have durable responsibility |

A fact may already be available in the current context. Request a new observation only
when the fact is needed and has not already been established. A missing or blocked
condition must not be bypassed by performing a different business action.

## Decision rules

Use authorized business actions and current facts to decide progression. The Skill may:

- retrieve UDM SM subscription data;
- select configuration within the admitted request and subscription constraints;
- create the UDM SDM subscription;
- create the PCF SM Policy Association;
- prepare the NAS/N2 session-management material required for delivery;
- initiate AMF N1/N2 Message Transfer;
- wait for authoritative core-network N4 and RAN business facts;
- propose completion when the business goal appears satisfied;
- stop when safe progression cannot be established.

Do not drive progression from a message merely being received or a side effect merely
being attempted. A missing business fact cannot be replaced by an assumption about what
a network component is expected to do.

## Occurrence identity

Every observation and action must belong to the same admitted UE request, PDU Session,
attempt and lifecycle. Do not substitute an unrelated operation, a previous attempt,
stale state or a late result from another occurrence.

A reference or acknowledgement may identify an operation, but it does not by itself
prove that the operation was executed, adopted by the network or converged to the
required business state.

## Unsafe inferences

Never make these substitutions:

- `Nudm_SDM_Get` success **does not mean** subscription evidence is usable.
- `Nudm_SDM_Subscribe` commit **does not mean** ownership verification can be skipped.
- `Npcf_SMPolicyControl_Create` success **does not mean** an unsupported conditional
  Policy Association Modification branch has succeeded.
- A request to establish initial user-plane resources **does not mean** those resources
  are ready.
- A transfer request being associated with this occurrence **does not mean** it was
  dispatched, acknowledged or accepted by the RAN.
- A successful transfer response **does not mean** the responsible network procedure
  adopted the result.
- AMF N1/N2 transfer success **does not mean** RAN setup is accepted.
- RAN setup acceptance **does not mean** N4 forwarding is ready.
- Earlier N4 establishment **does not mean** later forwarding convergence is complete.
- A successful RAN/N4 exchange **does not mean** the UE accepted anything locally;
  UE-internal state is not an Agent-observable business fact and is never a
  completion gate for this Skill.
- Successful business operations **do not mean** resource responsibility is finalized.
- Reaching the expected last business stage **does not mean** the business goal is met.
- Missing, stale, ambiguous, wrong-lifecycle or wrong-producer evidence **does not mean**
  PASS or FAIL; it remains UNKNOWN.

## Verification and evidence

Business facts must be established from current, trustworthy evidence, not inferred from
the model's interpretation of an action response.

Evidence must belong to the exact occurrence and, where required, to the producer that
performed the relevant operation:

- UDM subscription usability belongs to the exact subscription read;
- AMF transfer acknowledgement belongs to the exact N1/N2 transfer;
- RAN adoption and N4 forwarding convergence belong to the same current session
  occurrence and causal transfer;
- resource responsibility belongs to the current lifecycle.

Missing, stale, ambiguous, wrong-lifecycle or wrong-producer evidence remains UNKNOWN.
Never use latest-per-UE or latest-per-session state as a substitute for exact
occurrence/provenance binding.

## Ownership boundary

This Skill defines business progression and the facts required to prove completion.
Protocol transport and network side effects must occur only through authorized actions.
An action response or transport acknowledgement does not prove delivery, RAN adoption,
forwarding convergence or final completion.

## Completion

Operation success and Skill completion are different things.

The Skill succeeds only when the Contract independently establishes all required final
facts, including:

- the SMF adopted the RAN PDU Session Resource Setup of the current occurrence;
- the SMF/UPF downlink forwarding resources of the same N4 session instance are ready;
- created resources and late-result responsibility durably managed.

UE-internal state (NAS PS-ACTIVE, TUN, ping) is deliberately **not** a completion
fact: it is not Agent-observable, and the Agent must not claim it.

A model may propose completion, but the Contract is the final authority.

## Failure and recovery

Keep these outcome domains distinct:

- Predicate: `PASS / FAIL / UNKNOWN`;
- mutation certainty: `COMMITTED / NOT_COMMITTED / OUTCOME_UNKNOWN`;
- Procedure terminal: `SUCCEEDED / FAILED / UNRESOLVED / SAFE_STOPPED`.

Before resource creation begins, an explicit request/subscription/business rejection may
fail; unavailable or ambiguous required evidence remains unresolved.

Once resource creation begins, responsibility for created resources and late results is
retained through every exit.

If a mutation outcome is `OUTCOME_UNKNOWN`:

1. stop business progression;
2. reconcile the exact original mutation;
3. never blindly retry it;
4. never consume an output that may not exist;
5. safe-stop the current invocation according to the governed recovery policy.

Any later continuation is a new admitted recovery decision with a new authoritative
lifecycle identity.

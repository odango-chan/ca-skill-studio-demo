---
name: ensure-pdu-session
description: Ensure that a selected UE has the requested PDU Session target established with the required DNN and S-NSSAI semantics.
---

# Ensure PDU Session

## Purpose

Converge one requested PDU Session target independently from final business QoS.

Use this Skill after UE registration when the selected strategy requires a Session identified by the requested PDU Session id, DNN, and S-NSSAI.

## Boundary

Hard precondition:

`ue.registered == PASS`

Business postcondition:

`pdu_session.target.satisfied == PASS`

The target predicate means that the selected Session is established and its trusted DNN/S-NSSAI observation matches the request.

`pdu_session.absent` is an internal leaf predicate used only as the mutation gate. It may PASS only when the selected environment can authoritatively prove that the exact Session identity is absent. It is not the Planner-facing success condition.

If the requested target is already satisfied, verify and finish.

If the environment authoritatively proves that no Session exists at the requested PDU Session id, this Skill may use its admitted create capability. A failed establishment predicate, an unavailable read, or any UNKNOWN state is not absence and must not enable creation.

If a Session already exists at that id but the target predicate is false, do not silently teardown/recreate it. Return a stable failure boundary so the higher-level Planner can choose another admitted Session identity or an explicit destructive strategy.

It does not own final requested QoS satisfaction. Compose `ensure-session-qos` when QoS convergence is required.

## Model/output boundary

This executable Skill does not define a model response payload. The model must not declare that a Session exists, choose an unoffered concrete Session identity, or synthesize a Procedure graph.

The model-facing Skill text only constrains domain reasoning. Governed success is established by Runtime verification of `pdu_session.target.satisfied == PASS`.

## Baseline QoS execution input

The governed `pdu_session.create` capability requires baseline QoS material while establishing a Session. Therefore this Skill accepts a baseline 5QI execution input when creation is needed.

That input is an execution prerequisite for Session creation, not this Skill's final QoS business postcondition.

Do not infer that the final requested QoS is satisfied merely because Session creation committed.

## Reference-environment boundary

The active ca-agent-demo owner-backed profile uses env-5gc-sim. Its `PDU_SESSION` fact is a strong simulator-owned world fact and can authoritatively provide `exists`, `established`, DNN/S-NSSAI, QoS state, and definite absence.

That strength is environment-specific. Real Open5GS does not currently provide an equivalent canonical `established`/absence fact, and core-network code must not query UE/UERANSIM to manufacture one. Therefore this Skill's create branch is admitted only in an environment that provides authoritative absence plus an admitted create capability. The current real-5GC audit does not satisfy that condition.

## Recovery

Do not blindly retry after an unknown create outcome. Reconcile first; unresolved state must safe-stop.

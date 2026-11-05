# PDU Session Establishment: actors and causal boundaries

**Use when:** the next business decision depends on a 3GPP actor's
responsibility, the meaning of a network message, or the distinction between
an operation being initiated and the network converging.

This supplements [SKILL.md](../SKILL.md) for the *admitted initial
establishment profile*. It is not a normative 3GPP specification, a new
Procedure graph, or evidence about the current network.

## Roles in this narrow profile

| Actor | Business responsibility |
| --- | --- |
| UE | Requests establishment and ultimately receives/accepts its configuration |
| AMF | Relays UE session signalling and N1/N2 information; owns outer NAS handling and NGAP |
| SMF function | Coordinates subscription, session policy and user-plane readiness |
| UDM/SDM | Supplies SM subscription constraints and maintains the SDM subscription |
| PCF | Supplies the SM policy association and decisions, not RAN/UPF completion |
| UPF/N4 | Holds initial session resources and later forwarding state |
| RAN | Handles PDU Session Resource Setup and returns its own outcome |
| Provider/Fabric | Provide governed operation capabilities and traffic mediation, not success verdicts |

For the current **transitional** integration, the original SMF still performs
PFCP/N4 and participates in SMF compatibility transactions. The Agent does not
directly construct PFCP or arbitrary NGAP. A temporary SMF waiter is not the
source of the Agent's business decision or proof that a real network operation
completed.

## What one outcome does—and does not—establish

| Outcome observed | Still not proven |
| --- | --- |
| UDM SM-data HTTP response | Usability and applicability of its subscription evidence |
| UDM SDM Subscribe commit | Durable ownership of the subscription |
| PCF SMPolicyControl Create result | Authorization of all later branches, RAN acceptance or completion |
| Initial N4 resources ready | Required forwarding after RAN tunnel information |
| AMF N1N2MessageTransfer acknowledgement | RAN PDU Session Resource Setup acceptance |
| RAN setup accepted | N4 forwarding readiness or UE configuration acceptance |
| N4 forwarding ready | UE acceptance and resource responsibility finalized |

The requested parameters, subscription-constrained selection and effective
session configuration are different business layers. Even a valid lower-layer
result does not prove a higher-layer effect.

## Apply the explanation, not a scripted step list

After successful N1/N2 transfer, a model needing proof of RAN setup should
request the Skill-defined RAN business fact when admitted, rather than treating
the transfer acknowledgement as that fact. After RAN setup, distinguish initial
N4 establishment from N4 forwarding convergence. Governed waiting belongs in
the Harness, not in repeated model polling.

Which operation or fact is *currently* available comes only from Decision
Context and Available Actions. Exact producer and lifecycle matching, Predicate
verdicts and Contract completion remain Harness-owned. Missing unsupported
branches are not implicitly successful.

# Session selection: request, subscription and effective state

**Use when:** the admitted DNN, S-NSSAI, PDU Session Type, SSC mode, subscription
defaults or policy/configuration inputs appear ambiguous or inconsistent.

This material explains *business meaning*. It does not duplicate the governed
selection script, raw subscription parser, authoritative Predicate evaluator or
machine Procedure.

## Three different layers

1. **Requested:** the exact admitted UE occurrence has a requested DNN,
   S-NSSAI, PDU Session Type and SSC mode, bound to PDU Session ID and PTI.
   A subscription default is not permission to rewrite the admitted request.
2. **Subscription-constrained:** usable, current UDM data must establish that
   the requested combination is allowed. An HTTP success alone is not proof
   that data are complete, unambiguous or from the correct occurrence.
3. **Effective:** policy and real allocation results determine what can be
   delivered. Successful selection alone does not prove an address, UPF tunnel,
   RAN admission or UE acceptance.

The current profile remains local/non-roaming, UE-requested initial IPv4,
SSC mode 1, one default non-GBR flow. Do not silently substitute an out-of-scope
request with a convenient supported profile.

## Selection questions

| Dimension | Business interpretation |
| --- | --- |
| DNN | Match the requested DNN to current usable subscription data; do not silently choose another subscribed default |
| S-NSSAI | Preserve the authoritative SST/SD match; do not invent, drop or replace the SD value to force selection |
| PDU Session Type | The admitted IPv4 request must be supported, not converted to another listed type |
| SSC mode | The supported mode 1 must be permitted by the subscription default or applicable additional-mode list |
| QoS, AMBR, policy | Subscription values constrain selection and feed policy, but do not prove resource allocation or final network readiness |

In particular, preserve the exact returned `allowedSscModes` list: no truncation,
deduplication or invented normalization. A subscription's default SSC mode
remains permitted even when absent from the additional-mode list. Open5GS may
return a list including the default, while standards-shaped data may contain
only additional modes. The model must not assume the list alone exhausts
permission. The governed selection still has to establish SSC mode 1.

## Unknown is not an alternative selection

If subscription usability is not established, request its Skill-defined
business fact when useful and admitted; do not parse backend payloads or
declare a 200 response sufficient. If a current governed selection reports an
explicit applicable rejection, do not invent an alternate DNN, slice or SSC
choice. Stale, cross-occurrence, missing or ambiguous evidence remains
unresolved under the Predicate rules.

A valid selection does not authorize PCF creation or prove delivery readiness.
Input-read opaque handles, digests and exact session-instance correlation
belong to the Host/Harness and Provider, not to the LLM.

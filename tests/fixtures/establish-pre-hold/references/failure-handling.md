# Failure, uncertainty and resource-obligation meaning

**Use when:** a rejected operation, missing evidence, async convergence,
uncertain mutation or resource obligation changes whether to ACT, OBSERVE,
propose COMPLETE or STOP.

This reference is not a separate retry/cleanup Procedure. Skill assurance,
admitted actions, governed reconciliation and the final Contract retain
authority.

## Interpret outcomes without collapsing domains

| Signal | Safe business interpretation |
| --- | --- |
| Applicable explicit negative business result | An actual rejection may yield FAIL through Skill-defined verification; do not rewrite the request |
| Missing, stale, ambiguous or wrong-producer evidence | UNKNOWN / unresolved, not PASS and not automatically FAIL |
| Operation succeeded | Only that operation is known; its postcondition may still be unknown |
| Mutation COMMITTED | Side effect occurred; ownership and downstream business facts remain independent |
| Mutation NOT_COMMITTED | The specific mutation did not commit; other resources/earlier effects may still exist |
| Mutation OUTCOME_UNKNOWN | Stop progression; reconcile the **exact original** mutation; never blind-retry or use possibly nonexistent output |
| Transfer acknowledged but RAN/UE/N4 fact missing | Use admitted governed verification/await; do not infer network convergence |
| Last apparent business action succeeded | COMPLETE is a proposal; final Contract must independently accept all facts |

If a mutation outcome remains uncertain, the current invocation goes through
governed reconciliation and SAFE_STOPPED semantics. A later recovery requires
a separately admitted decision and a new authoritative lifecycle identity.
The model must not offer an ad-hoc retry or compensation.

## Resources survive an unsuccessful exit

Before the first resource-creating mutation, an explicit admissible business
rejection may end without inventing resources to clean up. Once resource
creation starts, ownership of created resources, callbacks and late results
must survive successful, failed, unresolved and stopped exits. Mandatory
finalization/retention is Harness responsibility, not an optional model action.

In the temporary integration, a correct Agent UDM/PCF result does not prove
the original SMF waiter received and consumed it, or that the SMF subsequently
made N4 progress. Missing safe association/continuation evidence blocks the
dependent business stage. Never forge an SMF response or infer network success
to escape that block.

## Avoid a verification loop

An UNKNOWN observation without a relevant world change is not a reason to
ask for the same fact every model turn. The Harness owns bounded awaits,
freshness handling, correlation and evidence reuse.

Use an admitted action if it can safely make progress; use OBSERVE for a
currently needed resolvable business fact; STOP when neither establishes
safe progression. A reference is never real-time evidence and never grants
permission to bypass admission, mutation guards or Contract closure.

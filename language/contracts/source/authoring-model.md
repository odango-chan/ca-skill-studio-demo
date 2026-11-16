# Authoring Model — Companion Notes

**Status:** Non-normative companion to the [CA-SL v1alpha4 Specification](skill-language-spec.v1alpha4.zh-CN.md).

The comprehensive specification is the sole normative language authority. If this file conflicts with it, the specification takes precedence.

## Author-maintained source

v1alpha4 retains three assurance source files with distinct responsibilities:

- `assurance/contract.yaml`: Skill's public contract — Goal, global Precondition references, public Request Schema, the Host Invocation Context Schema, shared dependency identities and Capability Grants.
- `assurance/procedure.yaml`: the single deterministic execution graph — start, nodes, routes, reconciliation and final Postcondition.
- `assurance/predicates.yaml`: reusable Predicate definitions and ordered parameter signatures.

Contract is author-maintained source, not a compiler-generated file. The source omits redundant `apiVersion`, `kind` and `metadata.name`; language version comes from BuildRequest / Compiler Target and Skill identity comes from the Package root.

## Contract and dependency semantics

- Goal and public Request belong to Contract, not the Procedure graph.
- Top-level `requestSchema` declares the Skill-owned Request. Top-level `contextSchema` links the exact Host-owned Invocation Context Schema. The Host validates the admitted Context and its references.
- `dependencies` maps each alias directly to a stable Package ID string. The trusted build caller binds the Package ID and allowed Owners to the existing snapshot alias and verified digest. Compiler links exact Owner exports.
- Top-level `capabilities` lists the requested grants. Dependencies make contracts available; grants request authorization.
- Studio guides creation by selecting dependencies and Capabilities from available public catalogs, writes stable identities into Contract and obtains exact dependency snapshots for the BuildRequest.
- Compiler receives exact bytes and trusted CapabilityContracts as inputs. It never downloads dependencies, manages versions or infers authorization from the set of imported Tools.
- The exact dependency snapshot / revision selected by Studio belongs to project/build configuration. Owner Schema IDs that intrinsically encode immutable revisions must be preserved exactly.

## Procedure graph

A business Node may declare `precondition`, `operation`, `observation`, and `postcondition`. Declare at least one stage. Runtime runs the declared stages in that order. A normal outcome advances within the Node when another stage follows. The current stage's `routes` maps an Outcome to a Node ID or one of the four Invocation terminal statuses. The last stage's normal outcome uses this map.

Contract may declare **one** global gate using `precondition: <node-id>.precondition`. That stage may evaluate multiple ordered `predicates`, and its **aggregate PASS** must precede every business Mutation or SUCCEEDED request. Each final success path uses a Postcondition aggregate `PASS: SUCCEEDED` edge directly; there is no `postcondition.goal`, Contract `preconditions` list or Goal proof carried across Nodes (§12.9).

CA-SL v1alpha4 has one entry Procedure graph per Skill and does not define nested ProcedureCall or graph cycles. Branches and recovery are explicit nodes and routes.

## Arguments and dataflow

- Tool Operation and Observation use a named arguments mapping defined by the Owner Input / Query Schema.
- Procedure Script uses a named arguments mapping as its exact local input projection; its Input and Output Schemas derive from the strict TypedDict annotations on the entry point.
- Precondition and Postcondition use an ordered arguments list matching the Predicate.parameters signature.
- Stages bind `arguments` to admitted `context` fields or to earlier outputs qualified by Node and stage.
- No implicit previous-node binding, parent Procedure state, ambient Context forwarding, or field-name guessing.
- Reconcile READ is an Owner-published, Host-controlled **internal outcome-resolution ability**, never an author `operation.reconcile`/`resolve` stage. `COMMITTED` alone does not expose the original output; only verified recovery normalizing the original Operation to SUCCEEDED, or an independent authoritative Observation, can support subsequent proof.

## Script roles

A Procedure Script is a pure local data transformation / selection invoked through a Node's `operation` stage. It is not a Tool, Capability, or external READ / MUTATION effect.

A Predicate Script implements a Predicate evaluator and returns the structured PredicateEvaluationResult. Its business inputs derive from Predicate.parameters. Runtime verifies the Predicate's `evidence.requires` independently of the Script's `evidenceUsed` report.

## Generated artifacts and policies

Compiler derives normalized contracts, execution graph, type bindings and generated Schema artifacts from the author sources and exact dependency snapshots.

- No Contract-level `entryProcedure` is needed because the Skill has one Procedure graph.
- Final Postcondition is an executable Procedure node, not a duplicate Contract list.
- Dynamic Procedure generation is forbidden by the static DAG language rule.
- Runtime enforces a positive Host action budget; Contract may optionally set a stricter `limits.maxActions` upper bound (counting dispatched Tool, Observation, Script and Reconcile actions). Effective limit is the minimum, and missing/zero Host budget fails closed.
- For Mutation UNKNOWN, reconcile the original attempt when a safe Owner contract and runtime conditions allow it. Otherwise stop and retain the original attempt and responsibility (§20).

Generated Schema serialization and whether a deployment bundle embeds the reachable external dependency closure or keeps exact external references belong to the separate Compiler / Deployment Artifact Contract—not the CA-SL node grammar.

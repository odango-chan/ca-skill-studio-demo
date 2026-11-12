# Current Skill Authoring Model

**Status:** Current business and Procedure semantics. Compiler conformance is tracked independently. Language authority is [Skill Language Specification](skill-language-spec.md); Script rules are in [Script Contract](script-contract.md).

## 1. One deterministic source graph

- `assurance/procedure.yaml` is the deterministic workflow source.
- `SKILL.md` is model-facing business guidance for an LLM-driven path.
- Do not maintain a second prose graph with duplicated next-node edges.
- Both execution styles retain the same resource boundary, Predicate truth, evidence authority and final Contract boundary.

## 2. Business-significant nodes

A main Procedure node represents a business-significant operation, side-effect boundary, independent asynchronous procedure, recovery boundary or recognizable protocol/service step.

Do not create main-flow nodes merely for a local projection, deterministic calculation, read-only context preparation or a single fact check when these can be expressed as preparation owned by the consuming node.

## 3. Node preconditions

`preconditions` are an ordered node-entry phase. They complete immediately before the node's main operation.

Supported step intents are only:

- `script`: Skill-owned pure local computation;
- `call`: a declared Tool Operation, subject to imported input Schema and Runtime authority;
- `verify`: a Predicate over already materialized evidence.

Preconditions must not contain mutations, hidden resource creation or operations requiring mutation reconciliation. The block stops at the first non-successful step. Its aggregate route distinguishes proven failure from unresolved evidence.

Node preconditions do not replace Runtime/Harness hard guards. Runtime still rechecks attempt, lifecycle, authority and mutation admission immediately before dispatch; do not copy implementation guards into every Skill node.

## 4. Node postconditions

`postconditions` establish facts after the node's main operation and before the business flow may advance.

- Successful read/local-compute results and committed mutations enter the postcondition phase when declared.
- Steps are ordered; the block stops at the first non-PASS result.
- Only the block's PASS route advances after every step passes.
- FAIL and UNKNOWN follow explicit routes.
- A mutation being COMMITTED does not by itself establish the business fact.

Node-level postconditions differ from `SkillContract.spec.postconditions`. The former govern whether one operation may advance; the latter are independent final acceptance conditions for the whole Skill.

## 5. Shared preparation results

A preparation result belongs inside a node when only that node consumes it. When later business nodes also consume it, it is shared Procedure data. Name the exact Producer through paths such as:

~~~yaml
from: <producer-node>.preconditions.<step-name>.output
~~~

Do not copy values into new inputs or invent implicit previous-node bindings. Compiler must resolve the exact Producer path or report it unresolved.

## 6. Script and Schema ownership

- A Script's identity is the Skill package plus its relative Python path.
- Procedure Script input is the per-call-site projection from `with:`; Predicate Script input is the declared Predicate Evaluation Context.
- A Script declares only its strict, non-empty Output `TypedDict`. Compiler generates its read-only Output JSON Schema.
- Do not author Script input/output Schema files, add `connectionagent-tool` metadata or create independent local Tool IDs.
- Scripts are deterministic local computation only. They do not call HTTP, MCP, Providers, shell commands or other Tools.

See [Script Contract](script-contract.md) and [Schema Ownership](schema-ownership.md).

## 7. Reconciliation

Use native `reconcile: <original-node>` for reconciliation of an original mutation. Preserve original Operation identity and uncertainty; never blindly retry an unknown mutation.

## 8. Cases are source obligations, not execution evidence

A Case records a scenario, context and expected outcome. It does not prove Compiler, Mock Runtime, Qualification suite or live network execution. Cases remain source material; Compiler does not implement a Qualification engine or Case runner.

## 9. Compiler boundary

Compiler consumes caller-supplied Skill and imported Owner/Tool files, performs static parse/link/type checks, generates output files and diagnostics. It does not acquire dependencies, manage a project, run Python, execute Tools, qualify a Skill or prove Runtime readiness.

# ConnectionAgent Skill Language Specification

**Version:** v0.2  
**Status:** Current source-language contract for the target stateless Compiler; implementation conformance is tracked separately.  
**Owner:** `ca-skills`  
**Consumers:** `ca-skill-compiler`, Skill Studio and future LSP.

This repository owns the official Skill language and official Skill source. The Compiler implements the language; it does not define a competing DSL, import format or package manager.

## 1. Authority and boundaries

`ca-skills` is the only authoritative source for Skill-authored language contracts and official Skill packages. Current `ca-agent-demo` source is a behavior/implementation reference used to refresh examples, not a second Skill source of truth.

- This specification defines source meaning, supported syntax, identity and reference positions.
- [Script Contract](script-contract.md) defines the only Skill-owned Python Script form.
- [Schema Ownership](schema-ownership.md) defines which producer owns each Schema.
- [Authoring Model](authoring-model.md) defines Procedure business semantics.
- [Semantic token projection](../language/semantic-tokens.v1.json) defines editor token categories; it does not define grammar or link success.
- The target Compiler parses, links, validates and generates outputs from supplied bytes. Studio/callers acquire dependencies and assemble BuildRequest. Compiler does not fetch, persist, lock, refresh or manage dependencies.
- A parsed or linked declaration is not proof of Tool implementation, permission, Runtime READY, execution, Case pass or live 5GC acceptance.

The old `ca-skill-toolchain` schema set is not a language authority. Compiler must implement this contract; it must not flatten or silently ignore source semantics to satisfy a legacy schema.

## 2. Language artifacts

| Layer | Source | Responsibility |
| --- | --- | --- |
| Model guidance | `SKILL.md` | Standard Skill frontmatter and model-facing business guidance |
| Skill contract | `assurance/contract.yaml` | Skill identity, goal, entry Procedure, request/context Schema references, resource grants and final conditions |
| Procedure | `assurance/procedure.yaml` | Deterministic graph, Operation calls, Script/Procedure/Predicate references, bindings and routes |
| Predicate set | `assurance/predicates.yaml` | Observation declarations and CEL or Script evaluation over materialized evidence |
| Case | `cases/*/case.yaml` | Source-level scenario and semantic obligation; not an execution or Qualification engine |
| Script | `scripts/*.py` | Skill-owned deterministic local computation with strict Output `TypedDict` |
| Skill-owned Schema | `schemas/**` | Public Request and other genuinely Skill-owned interfaces |
| Reference | `references/**/*.md` | Optional model knowledge, not executable syntax or evidence |
| Imported contracts | logical `lib/**` Compiler inputs | Tool/Host/Observation Owner contracts supplied by Studio/caller |

Generated Script Output Schemas are BuildResult outputs. They are not authored under source `schemas/` and are never Compiler inputs.

## 3. SkillContract

Canonical identity remains `apiVersion: connectionagent.io/v1alpha1` / `kind: SkillContract`. Important fields:

- `spec.inputs.requestSchema`: the Skill-owned public Request Schema.
- `spec.context.requiredFacts`: required fact identifiers only; **not** field-level Schemas.
- `spec.context.schemas`: explicit Owner Schema paths for `subject`, `facts`, `observations` and `evidence` when those namespaces are used.
- `spec.allowedResources.capabilities[]`: resource-grant upper bound. Values may be deployment Capability IDs or direct Operation IDs. It is not a Script allowlist.
- Contract-level preconditions/postconditions are Skill-wide conditions; they differ from node-level Procedure conditions.
- There is no `allowedResources.localTools`. A Script is an internal Skill source asset, not an independently invocable Tool.

Example of explicit external Schema ownership:

~~~yaml
spec:
  inputs:
    requestSchema: schemas/establishment-request.schema.yaml
  context:
    requiredFacts:
      - createdsession_ingress
    schemas:
      subject: lib/host/subject.schema.yaml
      facts: lib/host/facts.schema.yaml
      observations: lib/observations/context-observations.schema.yaml
      evidence: lib/host/evidence.schema.yaml
~~~

Every path is relative to the logical BuildRequest file set. A missing path or missing authoritative Owner Schema is an error when that namespace is used. Do not use `requiredFacts` names, arbitrary object declarations or deployment configuration Schemas as substitutes.

## 4. Procedure

The current source uses a map of named Procedures and named nodes:

~~~yaml
procedures:
  establish:
    inputs:
      dnn:
        type: string
        from: context.request.dnn
    start: read-subscription
    nodes:
      read-subscription:
        call: sbi.udm.sm_data.get
        with:
          dnn:
            from: input.dnn
        'on':
          SUCCEEDED: verify-subscription
          FAILED: failed
      verify-subscription:
        verify: example.subscription_usable
        'on':
          PASS: done
          FAIL: failed
          UNKNOWN: unresolved
      done:
        terminal: SUCCEEDED
~~~

Supported main-node intents are exactly:

| Intent | Meaning |
| --- | --- |
| `call` | Invoke one exact imported Tool Operation |
| `script` | Run a Skill-owned Script by package-relative path |
| `procedure` | Invoke a local Procedure or explicitly named cross-Skill Procedure |
| `verify` | Evaluate a Predicate |
| `reconcile` | Reconcile the exact original mutation node |
| `terminal` | End with a declared Procedure terminal result |

`call` is always a **scalar Operation ID**, for example:

~~~yaml
call: sbi.udm.sm_data.get
~~~

It is not a Capability group, dependency name, MCP tool name, object or `{dependency, operation}` pair. Studio/caller resolves and supplies required ToolCatalog files under logical `lib/**`; Compiler links the exact Operation ID across the supplied ToolCatalog set. Operation IDs must be unique in that set. Missing or duplicate IDs are errors. There is no source-level dependency namespace or alias.

`Procedure.inputs.<name>.from` and `with.<argument>.from` are explicit data bindings. `with` accepts exactly one of `from` or `value`. `Procedure.inputs.<name>.type` is an optional author assertion checked against the actual Producer Schema; it cannot create or replace a missing Schema.

A main-node `procedure` may reference a local Procedure by name or a cross-Skill Procedure by explicit `{skill, procedure}` identity. No implicit previous-node binding, string interpolation, dynamic selector or automatic Skill routing exists.

### 4.1 Node preconditions and postconditions

`preconditions` and `postconditions` are ordered node-entry / node-result phases with `steps` and an explicit `'on'` route. The only supported step intents are `call`, `script` and `verify`. Each named step has a local scope; references use exact producer paths such as `preconditions.<step>.output` or `<node>.preconditions.<step>.output`.

Unknown execution-affecting fields and unsupported action forms fail explicitly. `tool`, `for` and `applicability.when` are not part of this language version; old authoring notes are not permission to compile them.

## 5. PredicateSet

`assurance/predicates.yaml` declares Predicate identities and required Observations. An evaluator is either:

- `{type: cel, expression: ...}` — a CEL expression over already-materialized evidence; or
- `{type: script, ref: scripts/foo.py}` — a Skill-owned Predicate Script.

The `evaluator.ref` is a package-relative Script path, not a `skill.*` Tool ID. Predicate Script input uses the Predicate Evaluation Context defined in [Script Contract](script-contract.md). It does not acquire observations or call Providers.

## 6. Cases

Each Case is one `cases/<name>/case.yaml` source-level scenario and expected semantic obligation. Cases are not run by the Compiler. Compiler does not implement Qualification, a Case runner, a release gate or Runtime readiness.

## 7. ToolCatalog, Capability and Operation identities

The current approved ToolCatalog is `lib/tools/createdsession.tool.yaml`. It defines exact Operations in `spec.contracts[].operation`, with declared Effect and Input/Output/Reconcile Schemas.

Keep these identities distinct:

- Capability ID: deployment-owned resource grouping/authorization identity.
- Operation ID: one exact callable operation declared by ToolCatalog.
- Procedure `call`: always an Operation ID.
- `allowedResources.capabilities[]`: the Skill's declared resource-grant upper bound; current conventional PDU entries are direct Operation IDs.

A ToolCatalog snapshot proves only that a contract was supplied. It does not prove adapter registration, authorization, implementation readiness or successful execution. The MAS Skill's 16 `ca.pdu_session.*` Operation references remain unresolved because no approved MAS ToolCatalog is supplied. Its design draft is not an approved library.

## 8. Schema ownership

See [Schema Ownership](schema-ownership.md). The short rule: Skill owns its public Request Schema; Tool/Host/Observation owners own Producer Schemas; Procedure bindings derive Script input projections; Script `TypedDict` declares its computed output; Compiler generates the Script Output Schema.

## 9. Editor and Compiler consumers

The semantic token registry is [`language/semantic-tokens.v1.json`](../language/semantic-tokens.v1.json). It classifies source positions only. Token color does not imply successful linking.

Studio/caller assembles `files` and optional targets. Compiler receives those bytes, returns diagnostics and generated files, and does no acquisition or package management. Native Go and WASM must implement identical language semantics. Compiler build success does not mean Script execution, Runtime READY, Qualification or live 5GC success.

## 10. Change control

A language change must update this specification, the focused contract, positive/negative source fixtures, semantic-token projection and both authoring guides. Preserve current business Procedure semantics unless an explicit business-owner decision changes them. Compiler follows the language; it does not silently redefine it.

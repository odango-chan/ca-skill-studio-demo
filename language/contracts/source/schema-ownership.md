# Schema Ownership — Companion Notes

**Status:** Non-normative Schema ownership companion to the [current CA-SL v1alpha4 specification](skill-language-spec.v1alpha4.zh-CN.md). Historical examples in this note have no authority to override its exact Schema/Evidence/Owner rules; existing unported 5GC source files remain legacy.

The comprehensive specification is the sole normative source for Schema ownership, identity, Evidence, Observation and argument binding. If this note conflicts with the specification, the specification takes precedence.

## Ownership summary

- Skill owns its public Request Schema and genuinely Skill-owned data. The Request Schema lives under `schemas/**` and is referenced by `assurance/contract.yaml`.
- Tool Owner owns Operation Input / Output / Reconcile Schemas.
- Observation Owner publishes Query Input and normalized Output Schemas through ToolCatalog.
- Host owns the Invocation Context Schema and Evidence-reference projection. `contract.yaml` references the exact Host export in `contextSchema`. Host validates required fields and references at admission.
- Contract declares a direct alias-to-Package-ID map in `dependencies` and requested grants in `capabilities`. Dependency identity is not a version lock or download instruction; a Grant is not a dependency.
- Operation / Observation arguments are named mappings checked against Owner Schemas.
- Procedure Script arguments are named mappings that define the exact local input projection; strict return TypedDict generates the output Schema.
- Predicate arguments are ordered positional values checked against Predicate.parameters.
- Predicate Script inputs derive from the Predicate signature plus Host-attached Evidence refs; its strict return TypedDict generates PredicateEvaluationResult.
- Consumers must not copy external Owner Schemas into the Skill package.
- Schema is the JSON Schema data model; YAML and JSON are serialization formats. Source Skill-owned Schemas remain YAML-authoritative. Generated artifact serialization is a separate Compiler Artifact Contract decision.

## Dependency and snapshot boundary

Skill Studio lets the author select public dependencies and Capability Grants from the available catalogs. It writes stable dependency identities and requested grants to Contract, and resolves exact immutable dependency snapshots for the current project / BuildRequest.

Compiler verifies the existing snapshot digest and compares the Contract Package ID with the trusted caller binding for that alias and digest. It validates Owner and exact export identities before linking. The caller establishes provenance; Compiler consumes supplied bytes and metadata. Preserve immutable revision markers in Owner Schema IDs.

The trusted deployment CapabilityContracts is supplied separately from ordinary DependencySnapshot inputs. It defines exact callable membership and Effect; imported ToolCatalog bytes provide the corresponding callable schemas. Compiler validates that every external callable is covered by exactly one granted Capability and matches the trusted Effect.

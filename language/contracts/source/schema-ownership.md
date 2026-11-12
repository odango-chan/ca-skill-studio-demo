# Skill Schema Ownership v0

The source tree must contain only schemas owned by the Skill. A file being present in a Skill folder does not make that Skill the owner of every data shape it consumes.

| Contract | Owner | Source / Compiler treatment |
| --- | --- | --- |
| Public Skill Request | Skill author | `spec.inputs.requestSchema` points to `schemas/**`; Compiler resolves `context.request.*` from it. |
| Tool Operation Input / Output | Tool owner | Imported ToolCatalog under logical `lib/tools/**`; Compiler links exact Operation IDs and uses its Schemas. |
| Host Subject / Facts | Agent Host owner | Explicit `spec.context.schemas.subject/facts` paths into logical `lib/host/**`; missing files are `EXTERNAL_SCHEMA_MISSING`. |
| Observation payload | Observation source owner | Explicit `spec.context.schemas.observations` path into logical `lib/observations/**`. |
| Predicate evidence/provenance projection | Host / Runtime owner | Explicit `spec.context.schemas.evidence` path into logical `lib/host/**`. Never infer it from a Script or Case fixture. |
| Procedure Script input | No separate file owner | Derived per call site from `with:` Producer references. |
| Predicate Script input | Host evaluation context + declared observations | Derived from Request, explicit Host Schemas and Predicate observation declarations. |
| Script output | Skill Script | Generated from the Script's strict Output `TypedDict`; read-only BuildResult output, not author source. |

`context.requiredFacts` is a list of required fact identifiers, **not** a field-level data Schema. `Procedure.inputs.*.type` is at most an author assertion checked against its Producer; it cannot replace a missing Producer Schema.

## Current PDU Session external dependencies

The current conventional PDU Contract declares these logical Owner inputs:

- `lib/host/subject.schema.yaml`
- `lib/host/facts.schema.yaml`
- `lib/host/evidence.schema.yaml`
- `lib/observations/context-observations.schema.yaml`

These are references to required Owner contracts, not Schemas authored or fabricated in this repository. The current official `lib/` snapshot contains only `lib/tools/createdsession.tool.yaml` (12 Operations); the Host/Observation Schema files are not bundled. A strict build must report these missing inputs until the actual owners supply them. `root-routing-profile-v0.5.schema.json` is deployment configuration and is not a substitute.

## Compiler / Studio boundary

`ca-skills` owns Skill-authored contracts and official examples. Studio/caller prepares file bytes and supplies imported Owner/Tool contracts in the Compiler's logical `lib/**` namespace. Compiler parses and links supplied bytes; it does not discover, fetch, persist, version, lock or refresh dependencies. `outputFiles` are Compiler results; Studio decides how to display or export them.


## Additional Tool Owner Schema gap

The pinned `lib/tools/createdsession.tool.yaml` is an approved ToolCatalog snapshot, but the `sbi.udm.sm_data.get` Operation currently declares `outputSchema.properties.result` only as `{type: object}` with no nested `properties`. The conventional selection Script reads nested fields under `udmResult.subscription` (including S-NSSAI, DNN, PDU Session Types, SSC Modes, AMBR and default QoS), as well as response and provenance fields.

That broad `object` declaration is not sufficient evidence for those nested fields. The Compiler must not infer them from the Script body or restore the removed Skill-owned `selection-input.schema.yaml` as a workaround. Until the Tool Owner supplies a complete Operation Output Schema, strict linking of those nested accesses must remain an explicit unresolved/unsupported producer-schema diagnostic.

This is separate from the missing Host Subject/Facts/Evidence and Observation Owner Schemas above.

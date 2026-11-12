# Skill-owned Python Script Contract v0

**Status:** Current source contract for the target Compiler v0.2 language. This supersedes the old `# /// connectionagent-tool` metadata convention. It does not claim Compiler conformance has already passed.

## 1. Identity and entry point

A Script is a Python source file owned by exactly one Skill: `skills/<skill-name>/scripts/<relative-path>.py`.

Its only identity is **Skill name + package-relative Script path**. It does not declare a second name, Tool ID, Operation ID, Capability ID or version in Python comments.

The only supported entry point is:

~~~python
def main(input: dict) -> OutputType:
    ...
~~~

- The parameter is named `input` and annotated exactly `dict`. This is only the transport container, **not** an open input Schema.
- The return annotation names a non-empty `TypedDict` declared statically in the same file.
- No alternate entry-point names, extra parameters, `**kwargs` or untyped return values.

## 2. Input is derived from the invocation site

Scripts do not author their own Input Schema. The Compiler derives a separate input projection for each invocation.

### Procedure Script

For a `script: scripts/foo.py` step, the keys in that step's `with:` object form the Script input object. Each `from:` is resolved against the exact Producer Schema; each `value:` is a literal checked against the declared consumer type. A Script called at two sites may receive two different projections.

The Compiler must not treat `input: dict` as permission to access arbitrary fields. Missing Producers, unknown fields and incompatible types are errors. It must not create an editable Script Input Schema file.

### Predicate evaluator Script

For `evaluator: {type: script, ref: scripts/foo.py}`, the input is the Host-created **Predicate Evaluation Context**:

- `subject`: exact trusted Subject projection;
- `request`: Skill Request validated by `spec.inputs.requestSchema`;
- `facts`: Host-owned fact projection;
- `observations`: a map from each declared observation alias to its materialized payload;
- `evidence`: Host-owned provenance/evidence projection available to this Predicate evaluation.

The Compiler derives these fields from the Skill Request Schema, explicit `spec.context.schemas` Owner references and the Predicate's observation declarations. It does not infer an Owner Schema from Python access patterns or `requiredFacts`. The evidence projection also requires a real Host Owner Schema. Missing Owner input is an explicit unresolved external contract, not an invitation to invent a permissive object.

## 3. Script-owned Output Schema

A Script declares only the structure of the value it computes. The Compiler generates a read-only JSON Schema Draft 2020-12 from the return `TypedDict`.

Supported static forms:

- `str`, `int`, `float`, `bool`;
- nested `TypedDict` definitions in the same file;
- functional `TypedDict("Name", {...})` for JSON keys that are not valid Python identifiers (for example, the Tool wire key `5qi`);
- `list[T]`;
- `Literal[...]`;
- `NotRequired[T]`;
- `Annotated[T, {<literal JSON Schema constraints>}]`.

Supported literal constraints: string `minLength`, `maxLength`, `pattern`; numeric `minimum`, `maximum`; array `minItems`, `maxItems`, `uniqueItems`. Unknown constraints, dynamic expressions, unsupported annotations and invalid ranges are errors. Functional TypedDict is required where a wire key cannot be written as a Python class attribute.

Output rules:

- Output must be a non-empty, fully declared `TypedDict`; generated `additionalProperties` is `false`.
- Required and `NotRequired` fields are preserved exactly.
- `Literal` becomes `const` or `enum`.
- `dict`, `dict[str, T]`, `Any`, `object`, empty output classes and broad/dynamic unions are forbidden as Output types.
- No field, type or constraint may be guessed from the function body. The Compiler does not execute Python.
- The generated file belongs only to BuildResult output. Remove the leading `scripts/` and trailing `.py` from the Script path, then place the remaining relative path under `skills/<skill-name>/schemas/generated/` and append `.output.schema.json`. For example, `scripts/common/normalize.py` generates `skills/<skill-name>/schemas/generated/common/normalize.output.schema.json`. It is not author-editable source and must never be fed back as input.
- No generated Script Input Schema is produced. Imported Tool/Host/Observation Schemas remain their actual Owner's contracts.

If a Script merely forwards an existing Producer value, prefer a direct Procedure binding instead of introducing a Script and duplicate output type.

## 4. No metadata block or per-Script execution policy

Remove the old `# /// connectionagent-tool` block. Do not declare `inputSchema`, `outputSchema`, `effect`, `sandbox.network`, `timeout`, `name` or a local Tool identity in Python comments.

Skill Scripts are restricted to deterministic local computation. They must not access network/MCP/HTTP, shell/subprocess, filesystem, environment secrets, clocks, random sources, databases or credentials. The Host owns a fixed execution sandbox and timeout policy; a Script cannot widen it through source metadata.

A Script is not an independently invocable Tool or Capability. It is a Skill-owned source asset referenced by Procedure `script` or Predicate `evaluator.ref`. There is no `allowedResources.localTools`.

## 5. Current PDU Session migration

The five conventional PDU Scripts are the current migration examples:

| Script | Output declaration |
| --- | --- |
| `select_establishment_configuration.py` | `EstablishmentSelectionOutput` |
| `build_pcf_policy_inputs.py` | `PcfPolicyInputsOutput` (functional TypedDict for `5qi`) |
| `build_n1n2_delivery.py` | `N1N2DeliveryOutput` |
| `evaluate_udm_read.py` and `evaluate_transfer_start.py` | `PredicateEvaluationResult` |

Their business calculations and Procedure ordering are retained. The old Script input/output Schema files are removed from authoring `schemas/`; only the Skill-owned public Request Schema remains. Generated Output Schemas appear when the target Compiler builds the Skill.

This source refresh does not execute Scripts, run Cases, qualify the Skill, prove Host Owner schemas exist, or claim Compiler/Runtime acceptance.

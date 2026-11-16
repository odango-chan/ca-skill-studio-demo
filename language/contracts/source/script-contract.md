# Skill-owned Python Script Contract

**Status: historical/legacy Script implementation companion, NOT a standalone CA-SL v1alpha4 grammar or product qualification.** The current sole normative language authority is the [frozen CA-SL v1alpha4 single-file specification](skill-language-spec.v1alpha4.zh-CN.md). This note documents prior v0 Script conventions and may be used only where consistent with that frozen specification; it does not make unported 5GC sources or a previous Script profile v1alpha4-qualified.

Skill-owned Python is restricted deterministic local computation. It has two roles. Neither role is a Tool, external Operation, Capability, or general-purpose execution environment.

## 1. Procedure Script

A Procedure Script performs deterministic local selection, transformation or structured-data construction. It runs as the local target of a Node's Operation stage.

~~~yaml
prepare-policy-inputs:
  operation:
    script: scripts/build_pcf_policy_inputs.py
    arguments:
      subscriptionData: select-establishment-configuration.operation.output.subscriptionData
      subscriptionSource: select-establishment-configuration.operation.output.subscriptionSource
    routes:
      SUCCEEDED: create-policy
      FAILED: FAILED
~~~

Rules:
- The entry point is `main(input: InputTypedDict) -> OutputTypedDict`. Compiler derives both schemas from the strict TypedDict annotations.
- The call-site arguments mapping is the complete input projection.
- Compiler checks required keys, unknown keys and Source Schema assignability at every call site. Compiler and LSP check key accesses against the declared input type, including optional access and unsupported dynamic keys. Runtime validates the materialized input. Authors maintain no separate input schema file.
- The return annotation must be a strict TypedDict. Compiler generates its Output Schema, including supported Annotated, Literal and NotRequired constraints.
- The result is exposed as `<node-id>.operation.output` to later stages and reachable consumers.
- A Procedure Script is pure and deterministic. It cannot access network, HTTP, MCP, shell, database, filesystem, credentials, environment variables, clock or randomness.
- It cannot perform external side effects, declare Tool IDs, Capability IDs or READ/MUTATION Effect.
- Host / Runtime owns sandboxing, resource budget, deadline and cancellation.
- The function returns business data. Runtime emits SUCCEEDED after validating the return value against the derived Output Schema. Runtime emits FAILED with `SCRIPT_EXECUTION_FAILED` when the function raises an exception. A normal Python return that violates the derived Output Schema, including a non-mapping value, produces FAILED with `OUTPUT_SCHEMA_INVALID`. Both failure paths leave the successful output unavailable. Runtime gives global cancellation and deadlines priority. See CA-SL §§24.2 and 32.1.

## 2. Predicate Script

A Predicate Script implements the evaluator of a declared Predicate. Its business input signature is exclusively Predicate.parameters; every call site's positional arguments must match the ordered signature and be type-compatible.

~~~python
from __future__ import annotations

from typing import Annotated, Literal, TypedDict

class PredicateEvaluationResult(TypedDict):
    result: Literal["PASS", "FAIL", "UNKNOWN"]
    reasonCode: Annotated[str, {"minLength": 1}]
    evidenceUsed: list[str]

def main(input: PredicateInput) -> PredicateEvaluationResult:
    ...
~~~

Rules:
- The entry point is `main(input: PredicateInput) -> PredicateEvaluationResult`. Use postponed annotations. Compiler generates the read-only virtual TypedDict from the Predicate signature and Evidence projection, and the build checker and LSP consume the same stub. See §32.2.
- Business input types derive from the owning Predicate's ordered parameters.
- Host / Runtime may attach a reserved, read-only Evidence projection; it is not an extra positional business parameter.
- result is the only field that controls PASS / FAIL / UNKNOWN routing.
- `evidenceUsed` may cite only Evidence refs already attached to this Predicate Invocation. Runtime separately verifies the guarantees in `evidence.requires` before accepting a definite result. See CA-SL §17.
- The strict return TypedDict generates the evaluator Output Schema; no competing hand-maintained Script Output Schema is allowed.
- CEL Predicate evaluation follows the same tri-state semantics; Runtime normalizes its result and preserves the input / Evidence lineage.

## 3. Static and runtime constraints

- Compiler / LSP provides a derived read-only input type environment. Authors do not maintain duplicate Script Input Schemas.
- Compiler validates annotations and restrictions without executing Python to infer schemas or behavior.
- Script cannot use dynamic imports, arbitrary reflection, eval/exec, network, shell, database, filesystem, credentials, environment variables, clock or randomness.
- Script cannot acquire Observation data or call Tool / MCP interfaces.
- Script cannot access undeclared ambient Context or mutate Runtime state.

# CA-SL v1alpha5 Example Skills

**Language baseline:** CA-SL v1alpha5 candidate  
**Source:** [ca-skills PR #65](https://github.com/odango-chan/ca-skills/pull/65), commit `84039bb8ad73ec1bc2aa0c93e2834e3bd7aeceef`  
**Normative draft:** [ca-skills PR #61](https://github.com/odango-chan/ca-skills/pull/61)  
**Qualification:** NOT_QUALIFIED

This directory contains the two v1alpha5 candidate Skills used by the Skill Studio Example project:

- `establish-pdu-session` — conventional 5GC PDU Session establishment. Step 15 uses Node-entry Event Wait; the Step 11 transfer Operation is its trigger, and the paired Step 17 response has an explicit response boundary after Step 16.
- `establish-pdu-session-mas` — an OpenAMSM/MAS source-aligned example. Its composite MAS Owner Operation retains its own correlation; this sample does not claim a separate 3GPP event contract.

The 5GC Contract declares an ordinary `integration` dependency placeholder. The actual trusted IngressCatalog export, Owner identity, normalized request/response Schemas, trigger binding, correlation and response mapping are not yet published. The sample is therefore a source-authoring candidate, not an executable or qualified Skill.

## Qualification boundary

The source examples demonstrate v1alpha5 candidate syntax and its Procedure, Contract, PredicateSet, Schema, and Script references. They do not establish that every referenced Tool, Capability, Schema, Evidence Guarantee or Ingress Operation has been published by its Owner.

The 36 EW conformance obligations are normative acceptance requirements; this snapshot does not claim they have all been executed. Compiler, Studio/LSP, Host, Runtime, Integration and Owner conformance remain NOT_QUALIFIED.

## Existing Example workspaces

The Example project uses one active authoring baseline: CA-SL v1alpha5 candidate. The v1alpha4 sample snapshot is no longer imported.

When an Example project already exists, Skill Studio asks whether to replace it:

- **Replace Example** deletes the entire existing Example project directory, including local edits, then imports this pinned v1alpha5 candidate snapshot.
- **Cancel** leaves the existing Example project untouched.

This replacement prompt applies only to the built-in Example project. It is never shown for ordinary user projects.

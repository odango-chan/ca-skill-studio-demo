# Canonical CA-SL language imports

This directory pins the normative source files from the sole language authority, `odango-chan/ca-skills`.

## Active Skill Studio target: v1alpha5 candidate

- Repository: https://github.com/odango-chan/ca-skills
- Candidate PR: https://github.com/odango-chan/ca-skills/pull/61
- Immutable candidate commit: `12a9512a9eae006ad4578daf37ebe0bdf3070642`
- Language target: `connectionagent.io/v1alpha5`
- Status: **PUBLIC REVIEW DRAFT — NOT RELEASED / NOT QUALIFIED**
- Normative single-file source: `source/skill-language-spec.v1alpha5.zh-CN.md`
- Normative source blob SHA: `2916fa78bd095ee5809136389cda4cdb6302b9d9`
- Companion Compiler candidate: [ca-skill-compiler PR #30](https://github.com/odango-chan/ca-skill-compiler/pull/30), commit `34993dc30b66f4cf7d573cbc81d884c356062a12`, **WP2 only**.

The v1alpha5 candidate inherits the immutable v1alpha4 baseline and adds Node-entry Event Wait. Studio projects the four existing business stages unchanged and models Wait separately as Node-entry control. The local projection is read-only/editor-only; it does not replace Compiler conformance.

The pinned Compiler candidate PR #30 can parse the current v1alpha5 Wait AST and run its supported Check slice on that draft branch. **Studio does not integrate this draft Compiler.** The online Extension still bundles Compiler v1.0.0 for v1alpha4 and therefore blocks v1alpha5 Check, Build and Dependency Inspection. The candidate's Build intentionally remains fail-closed until WP3–WP8 are complete; Dependency Inspection and trusted IngressCatalog linking are not yet available through it.

## Historical frozen v1alpha4 source

- Immutable commit: `7f84393ee8c395e4d8c39a74cb5000a1f896588d`
- Language target: `connectionagent.io/v1alpha4`
- Status: **FROZEN — language semantics only**
- Normative source: `source/skill-language-spec.v1alpha4.zh-CN.md`
- Normative source blob SHA: `b70064c5737b8ee2b3d1435fe496357f44b42773`

v1alpha4 is retained as an immutable inheritance baseline and historical source snapshot. It is not a parallel active authoring target or a product compatibility mode.

## Historical and editor-only contracts

- `source/skill-language-spec.zh-CN.md` is the historical v1alpha3 text.
- `semantic-tokens.v1.json` is the legacy ca-skills v0.2 semantic-token registry. Its selectors and legend do not define v1alpha5 grammar, linking or conformance.
- The v1alpha5 AST semantic-token projection in `language/semantic-tokens.mjs` is editor presentation only. No upstream v1alpha5 semantic-token selector contract is published.

## Qualification boundary

The v1alpha5 normative candidate is not released or frozen. Compiler, Studio/LSP, Host, Runtime, Integration, Owner and 5GC conformance remain **NOT_QUALIFIED**. In particular:

- the 36 EW cases are normative acceptance obligations, not claims of completed execution;
- the v1alpha5 Compiler branch currently implements WP2 only;
- no trusted production IngressCatalog export, Owner snapshot, deployment binding or real 5GC E2E is implied by the sample.

Do not edit source snapshots independently. Refresh them only from an explicitly selected immutable `ca-skills` commit and update the lock and blob SHA together.

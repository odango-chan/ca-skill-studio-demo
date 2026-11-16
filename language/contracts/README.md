# Canonical CA-SL language imports

This directory pins the **current normative language source** from the sole authority, `odango-chan/ca-skills`.

## Frozen v1alpha4 source

- Repository: https://github.com/odango-chan/ca-skills
- Immutable commit: `7f84393ee8c395e4d8c39a74cb5000a1f896588d`
- Language target: `connectionagent.io/v1alpha4`
- Status: **FROZEN — language and explicit v1alpha4 interop profile only**
- External profiles: `connectionagent.io/toolcatalog/v1alpha4` and `connectionagent.io/capability-contracts/v1alpha4`; no v1alpha3 fallback.
- Normative single-file source: `source/skill-language-spec.v1alpha4.zh-CN.md`
- Normative source blob SHA: `b70064c5737b8ee2b3d1435fe496357f44b42773`
- Discovery entry blob SHA: `5603c3c6b6c76ade82f1aaa8523e93adbeaec2dd`

The exact complete normative file is copied byte-for-byte from the pinned commit. `source/skill-language-spec.md` is only the non-normative discovery entry. The companion Script Contract, Schema Ownership and Authoring Model files are also pinned from the same commit; the complete CA-SL file remains the sole normative authority.

## Historical and editor-only contracts

- `source/skill-language-spec.zh-CN.md` is the historical v1alpha3 text. It is retained for historical references only and is **not** the v1alpha4 authoring target.
- `semantic-tokens.v1.json` is the legacy ca-skills v0.2 semantic-token registry. It is retained only for explicitly legacy source coloring. Its selectors and legend do **not** define v1alpha4 grammar, linking or conformance.
- The current v1alpha4 AST semantic-token projection in `language/semantic-tokens.mjs` is an editor presentation implementation. It is not a language grammar, does not establish reference resolution, and is not claimed to be an upstream normative token contract. The pinned ca-skills commit does not publish a v1alpha4 semantic-token selector contract.

## Qualification boundary

CA-SL v1alpha4 language semantics are frozen. Compiler, Studio/LSP, Host, Owner and 5GC product conformance remain **NOT_QUALIFIED** until the independent §45.2 evidence is completed. In particular, a Studio parser, completion provider, hover or Definition result does not prove Compiler diagnostic parity, trusted Owner identity, Capability authorization or Runtime readiness.

Do not edit these source snapshots independently. Refresh them only from an explicitly selected immutable `ca-skills` commit and update the pin and blob SHAs together.

# Skill Studio semantic colors · v0.1

**Scope:** YAML semantic color overlay, no new LSP protocol methods or Compiler
behavior. The original upstream YAML/Python TextMate grammars stay intact.

## Single contract

Canonical classification: `ca-skills/language/semantic-tokens.v1.json`.

The Studio vendored, pinned copy is
`language/contracts/semantic-tokens.v1.json`, with canonical Git blob SHA
`fe82778cffbcb05c5e9f7eb488e127d4fa171326`.
`tests/skill-semantic-tokens.test.mjs` checks the exact Git blob hash, legend,
extension contributions, token scopes and theme mappings. Refresh the copy
only from the owning contract and update the pin intentionally. Do not
duplicate a second hand-written Skill keyword table in the extension.

The contract classifies source positions. It is **not** machine-grammar
acceptance or proof of a resolved Capability. Those remain future Compiler
and LSP responsibilities.

## Pipeline

```text
Existing Skill YAML text
   → existing yaml@2 AST/CST parser (no source rewriting)
   → data-driven contract rule matching
   → exact UTF-16 scalar ranges and semantic token IDs
   → VS Code/Theia DocumentSemanticTokensProvider
   → Skill Studio Light semanticTokenColors
```

The provider is a thin local adapter. When the LSP starts producing these
tokens, remove or disable this adapter instead of letting two providers own
the same source document. This change does not modify the current LSP
Worker, rename/navigation/diagnostics or Compiler implementation.

## Visual distinctions

- Structural fields use the Studio's green accent.
- Operators and Capability/Tool identities are purple.
- Procedure/Node and Outcome identities use amber.
- Predicate and data types use blue; imported Observation/Schema/Script
  references use teal; bindings use muted slate.

These are **theme choices**, not language rules. Quoted `'on'` and named
identifiers only gain a semantic color in the structural position defined
by the contract. A literal `PASS` in a description must retain ordinary
YAML string coloring.

## Verification

Run root tests, including
`node --test tests/skill-semantic-tokens.test.mjs`, and the existing
IDE host tests/builds. In real Theia/Chromium open both
`assurance/procedure.yaml` examples, their Contract/Predicate files
and an imported ToolCatalog; inspect `call`, Capability values,
`preconditions`, `PASS`, `reconcile` and unaffected user strings.
Keep Chromium/Pages status **NOT_RUN** until that host actually renders
and reports these tokens.

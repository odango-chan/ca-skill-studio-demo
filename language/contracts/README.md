# Canonical Skill Language contract imports

This directory contains read-only, build-time snapshots imported from the sole language authority, `odango-chan/ca-skills`.

## Pinned source

- Repository: https://github.com/odango-chan/ca-skills
- Commit: `3fce09aca32b6a6faf6ec3e9a204d38cc129ec38`
- Skill Language: v0.2
- Semantic token projection: v0.2.0

| Authority | Canonical source path | Source blob SHA |
|---|---|---|
| Skill Language | `docs/skill-language-spec.md` | `bc81fb340827521da3452074974f9e3663043b10` |
| Script Contract | `docs/script-contract.md` | `b663977ef56d95538a50c13cda9301f28079697c` |
| Schema Ownership | `docs/schema-ownership.md` | `95900448bd7409b7a07faaa0337aebb872ee0e66` |
| Authoring Model | `docs/authoring-model.md` | `250f2eb1557f9432380596026e7b1a7103ffc501` |
| Semantic Token Projection | `language/semantic-tokens.v1.json` | `618c5c671f2c18785ecc10f84b9d549f88b4b138` |

The exact read-only source copies are stored under `source/` (including the Chinese Skill Language specification). The canonical source-language specification and supporting contracts define authoring semantics. The semantic-token JSON defines only editor source-position projection; it is not a grammar, parser, linker, compiler schema, or proof that a reference resolves.

Do not edit these snapshots independently. Refresh them from an explicitly selected `ca-skills` commit and update the recorded commit/blob SHAs together. A contract drift test verifies the semantic-token snapshot's Git blob SHA, version and legend. Compiler Build remains authoritative for parse/link/binding validation; Studio's editor-time language services must not invent missing Owner Schemas or Tool Operations.

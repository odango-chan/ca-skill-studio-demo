# Canonical CA-SL language imports

This directory pins the normative source files from the sole language authority, `odango-chan/ca-skills`.

## Active Skill Studio target: v1alpha5

- Repository: https://github.com/odango-chan/ca-skills
- Immutable release commit: `0abfd0e1ab99f481a4ae01f3f47efc54783dd5e5`
- Publication: CA-SL v1alpha5 Release / ca-skills #66
- Language target: `connectionagent.io/v1alpha5`
- Status: **FROZEN / RELEASED — language semantics only**
- Normative single-file source: `source/skill-language-spec.v1alpha5.zh-CN.md`
- Normative source blob SHA: `caef0a03ce1db53aeeca6717cd3c8c0c70d952c3`
- Current Example source: ca-skills `main` at `de8d9f667dd1a445c3f6378e0ca793d7407d2036`

The Studio has one active language target: v1alpha5. v1alpha4 is retained only as the immutable normative inheritance baseline and historical source; it is not accepted as a product authoring mode and is not migrated automatically.

## Examples

The built-in Example is copied from the current `ca-skills/main` v1alpha5 examples and pinned by immutable commit and per-file Git blob SHA in `site/samples/v1alpha5/files.json`.

The Example is illustrative and remains **NOT_QUALIFIED** for Compiler, Owner, Host, Runtime and 5GC integration. Release of the language does not imply product qualification.

## Compiler boundary

The published v1alpha5 language does not make the published v1alpha4 Compiler v1.0.0 compatible with v1alpha5. Studio must fail closed for compiler actions until a v1alpha5 Compiler release is integrated and the Studio adapter is validated.

The current v1alpha5 Compiler candidate is [PR #38](https://github.com/odango-chan/ca-skill-compiler/pull/38), pinned for status tracking at commit `ea27f18549725166f304b7d06fd9339bb0554329`. It remains Draft / unmerged and is not integrated into Studio. Its PR description reports `FULL_LANGUAGE_VALIDATION` with local acceptance evidence; this is not a released Compiler or product qualification. PR #30 has been superseded by #38 and must not be used as the current candidate.

## Historical source

- v1alpha4 immutable commit: `7f84393ee8c395e4d8c39a74cb5000a1f896588d`
- Language target: `connectionagent.io/v1alpha4`
- Status: **FROZEN — inheritance baseline only**

The historical v1alpha4 source remains available so the v1alpha5 specification can be audited against its inherited baseline. Studio does not expose it as a compatibility mode.

## Editor-only contracts

- `semantic-tokens.v1.json` is a legacy ca-skills v0.2 registry and is not a CA-SL v1alpha5 language contract.
- The v1alpha5 semantic-token vocabulary in `language/semantic-tokens.mjs` is Studio presentation metadata only.

Do not edit imported normative source snapshots independently. Refresh them only from the selected immutable ca-skills release and update the lock and blob SHA together.

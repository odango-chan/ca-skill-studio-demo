# Studio example Skills (ca-skills)

The two built-in authoring examples are pinned byte-for-byte to
[`odango-chan/ca-skills`](https://github.com/odango-chan/ca-skills) at
`3fce09aca32b6a6faf6ec3e9a204d38cc129ec38` (November 11, 2026):

- `establish-pdu-session`
- `establish-pdu-session-mas`

`files.json` is the allowlist for imported source files. It includes `SKILL.md`,
`assurance/`, `references/`, `schemas/`, and `scripts/` that exist in the
pinned `ca-skills` examples. `cases/` is excluded from this authoring
demo; the runtime/contract example is not a test fixture or package manager.

Previous `ca-agent-demo` snapshots and superseded schema files can remain
in the repository for existing Classic regression tests, but are **not**
automatically imported into a new Studio workspace.

The browser loader creates `skills/`, `lib/` and `output/` under the
extension-owned demo project. It never overwrites existing files, including
user-edited versions of these two examples; reloading can add missing files
but cannot silently upgrade existing source. User-controlled workspaces are
not reused as the sample destination.

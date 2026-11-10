# Current dual-SKILL studio demonstration

Snapshot of the two runtime-used SKILL packages from `odango-chan/ca-agent-demo` at `f022319052f9c8a9a9b85a67ef485b135e416379` (November 10, 2026).

- `establish-pdu-session`
- `establish-pdu-session-mas`

Only `SKILL.md`, `assurance/`, `references/`, `schemas/` and `scripts/` are copied. `cases/` and `design/` are deliberately excluded because the online Studio Demo focuses on runtime-used authoring assets, not case/test workspaces. Source copies are byte-identical to the pinned repository. Legacy `site/samples/packages/establish-pdu-session` remains intact for existing Classic regression fixtures.

The browser loader creates both packages under one `skills/` workspace, preserving existing files and applying no implicit Runtime / 5GC execution.

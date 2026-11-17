# CA-SL v1alpha4 Example Skills

**Language baseline:** CA-SL v1alpha4  
**Source:** [ca-skills PR #58](https://github.com/odango-chan/ca-skills/pull/58), commit `ab189d5dd62763be4cd2f00cc8047a0c5982b6be`  
**Qualification:** NOT_QUALIFIED

This directory contains the two v1alpha4 Skills used by the Skill Studio Example project:

- `establish-pdu-session` — conventional 5GC PDU Session establishment.
- `establish-pdu-session-mas` — an OpenAMSM/MAS source-aligned example.

The Example importer places both packages directly under `skills/`. The v1alpha4 packages are the active authoring, validation, and Compiler test baseline. The previous v0.2 sample set is no longer used for product acceptance.

## Qualification boundary

The source examples demonstrate CA-SL v1alpha4 syntax and its Procedure, Contract, PredicateSet, Schema, and Script references. They do not establish that every referenced Tool, Capability, Schema, or Evidence Guarantee has been published by its Owner.

The conventional 5GC Skill is the primary example. The MAS Skill is retained to illustrate the source mapping to OpenAMSM; it is not an end-to-end qualification claim.

## 3GPP references

The source pins versions independently by specification. The current set includes TS 23.502 V19.9.0, TS 23.501 V19.9.0, TS 23.503 V19.8.0, TS 29.502 V19.7.0, TS 29.503 V19.7.0, TS 29.512 V19.6.0, TS 29.518 V19.8.0, and TS 29.244 V19.6.0. Consult each Skill's `SKILL.md` for the complete reference list and the mapping of its Nodes to 3GPP procedure steps.

## Existing Example workspaces

The Example project uses one active language baseline: CA-SL v1alpha4. The retired v0.2 sample set is not imported, archived, or used for acceptance.

When an Example project already exists, Skill Studio asks whether to replace it:

- **Replace Example** deletes the entire existing Example project directory, including local edits and retired sample content, then imports this pinned v1alpha4 snapshot.
- **Cancel** leaves the existing Example project untouched.

This replacement prompt applies only to the built-in Example project. It is never shown for ordinary user projects.

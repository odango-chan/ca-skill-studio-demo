# CA-SL v1alpha5 PDU Session examples

- **Language target** `connectionagent.io/v1alpha5`
- **Normative source** [CA-SL v1alpha5 release record](https://github.com/odango-chan/ca-skills/blob/0abfd0e1ab99f481a4ae01f3f47efc54783dd5e5/docs/releases/ca-sl-v1alpha5.md)
- **Status** Illustrative authoring examples. Product and Owner qualification remains `NOT_QUALIFIED`.
- **Pinned 5GC Example source** `odango-chan/ca-skills@a1ed951b1e677f824c644541a26f08be4dc4847f` (`examples/skills/`), all four packages.

- [establish-pdu-session](establish-pdu-session/SKILL.md) models the conventional 5GC success path. The Step 11 transfer Operation triggers the Step 15 Node-entry Wait. The accepted request is available as `wait.output`, the authored timeout goes to `SAFE_STOPPED`, and Step 17 has its own typed response boundary after Step 16.
- [establish-pdu-session-mas](establish-pdu-session-mas/SKILL.md) follows the OpenAMSM MAS source plan. The composite MAS Operation handles its own event correlation.
- [modify-pdu-session-mas](modify-pdu-session-mas/SKILL.md) follows the OpenAMSM Modify PDU Session source plan with UE/AMF/network-requested trigger classification.
- [release-pdu-session-mas](release-pdu-session-mas/SKILL.md) follows the OpenAMSM Release PDU Session source plan with explicit trigger mapping.

## Bundled example-only Interface Package dependency

On first creation, or after explicitly confirming **Replace Example**, Studio
preinstalls and locks the exact public
[`ca-client-tools v1.1.0` Interface Package](https://github.com/odango-chan/ca-client-tools/releases/tag/v1.1.0)
under alias **`ca-client`**. It is shipped inside Studio and verified against
`sha256:cbd8fad939844cda5474f33f18d3cdc015c69dd8c1dc3908e84bd5273ce6e71b`.
No GitHub fetch, manual ZIP selection or runtime network access is required to
open the Example. The immutable bytes live under `.skill-studio/dependencies/`;
their declaration and lock live in `.vscode/settings.json`.

In a Procedure `observation` you can type `ca-client::openamsm.smf.mas.sc.query`
as the `tool`, then use native YAML completion under `arguments:` for
`supi` and `pduSessionId`. The read-only Package Explorer also exposes the
published `*.schema.json` bytes; Provider-authored `*.schema.yaml` remains
the upstream source format, not an editable released dependency.

**Boundary:** This v1.1.0 package provides published READ/query interfaces,
not the complete mutable 5GC/MAS Tool/Owner contracts or Compiler authorizations
needed to execute the four illustrative Skill workflows. Completion is strictly
`AUTH_NOT_CHECKED`, and the imported dependency is `Compiler NOT_LINKED`.
It is not a production Admission or real-5GC qualification. The conventional
Skill's `integration` placeholder and other `urn:example:` values remain
illustrative. Changing/removing the pinned dependency in an existing Example
is respected; non-replacing Example reload does not silently restore it.


# CA-SL v1alpha5 PDU Session examples

- **Language target** `connectionagent.io/v1alpha5`
- **Normative source** [CA-SL v1alpha5 release record](../docs/releases/ca-sl-v1alpha5.md)
- **Status** Illustrative authoring examples. Product and Owner qualification remains `NOT_QUALIFIED`.

- [establish-pdu-session](skills/establish-pdu-session/SKILL.md) models the conventional 5GC success path. The Step 11 transfer Operation triggers the Step 15 Node-entry Wait. The accepted request is available as `wait.output`, the authored timeout goes to `SAFE_STOPPED`, and Step 17 has its own typed response boundary after Step 16.
- [establish-pdu-session-mas](skills/establish-pdu-session-mas/SKILL.md) follows the OpenAMSM MAS source plan. The composite MAS Operation handles its own event correlation.

The conventional Skill's `integration` dependency stands in for the deployment's trusted IngressCatalog package. Building the examples requires the exact Owner exports and trusted bindings. The Ingress Operation, its Schemas and response mappings, and the MAS ToolCatalog remain unpublished for these examples. All `urn:example:` values are illustrative.

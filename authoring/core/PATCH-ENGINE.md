# CA-SL v1alpha4 Semantic Patch Engine spike

This module is the first source-range patching implementation for CA-SL v1alpha4.

## Supported semantic operations

- procedure.start.set
- node.add
- node.stage.add
- stage.route.set
- stage.callable.set (same Tool / Script field only)
- stage.argument.set
- predicate.call.add
- predicate.call.arguments.set (same positional arity only)

The engine uses yaml@2 AST ranges to create minimal source edits. It never serializes the whole Procedure document. Comments, quote style and unrelated Source bytes are preserved outside the edited scalar / insertion ranges.

## Authority and safety

- Checks the live document URI/version, Package generation and SHA-256 base digest.
- Writes are limited to assurance/procedure.yaml.
- All new Node / stage / route / Predicate references are checked against the current or proposed graph where applicable.
- Related Node additions and their incoming route / start edits are grouped atomically.
- Partial acceptance materializes selected groups against the original Source.
- Candidate YAML is parsed again before it is returned.
- It never writes files, applies WorkspaceEdit, auto-saves or invokes Compiler / Runtime / Tools.
- Compiler Check on the candidate Package remains a separate required Host step.

## Deliberate limits

- Tool-to-Script kind switching is blocked.
- Predicate argument edits must preserve positional arity.
- The engine does not claim full CA-SL semantic validity, Owner linking or qualification.

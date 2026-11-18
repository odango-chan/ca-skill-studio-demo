# AI Authoring Core foundation

This folder contains the first host-neutral model-client and proposal-validation contracts.

## Boundaries

- No imports from VS Code, Theia, DOM, Node-only modules or Cloudflare.
- The Gateway client receives a Fetch implementation from its Host Adapter and sends browser requests with credentials included so the configured Access session can authenticate them. It sends a stable Host-generated `x-opencode-session` ID for the Editor Tab session; the Gateway injects the product User-Agent and forwards the session header to OpenCode Go. It never receives a provider key or client-supplied model.
- The Context Pack builder accepts only the live v1alpha5 Preview Procedure and allowlisted Package-relative context; references and scripts require explicit opt-in; dependencies require verified metadata.
- The Procedure Agent orchestrates one bounded proposal request, verifies the exact manifest and validates every model-authored reference; it exposes no file-write or Runtime operation.
- Context Pack size is checked against the serialized JSON envelope in UTF-8 bytes. The initial cap is 128 KiB to leave room for the system prompt and request metadata; oversized input is rejected, never silently truncated.
- No provider API key or model identifier is accepted from the client.
- A request cannot be sent until the caller confirms the Context Pack disclosure.
- ModelProposal is untrusted and validated against a versioned Studio-owned schema.
- The model cannot author source offsets, file paths, candidate YAML, WorkspaceEdit, atomic groups or validation state.
- Every evidence reference must resolve to an ID in the exact Context Pack manifest supplied by the host.

This is not yet the full Authoring Core. It does not provide the Authoring Editor Tab, compute atomic groups, patch YAML or apply edits. The v1alpha5 Semantic Patch Engine remains a separate Host-owned implementation gate.

## Tests

Run from the repository root:

~~~bash
npm test
~~~


## v1alpha5 Preview boundary

- The core accepts only `connectionagent.io/v1alpha5`; it never falls back to the published v1alpha4 Compiler or parser.
- The model prompt treats Node-entry Wait as control before the first business stage. It cannot invent trusted IngressCatalog / Owner / correlation contracts.
- `wait.event.source` is a legitimate selector field only inside the typed Wait event object; generic source-authority fields remain rejected.
- The full v1alpha5 Compiler is not yet available. A partial WP2 parser result is not a full candidate Check PASS.

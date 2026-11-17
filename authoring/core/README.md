# AI Authoring Core foundation

This folder contains the first host-neutral model-client and proposal-validation contracts.

## Boundaries

- No imports from VS Code, Theia, DOM, Node-only modules or Cloudflare.
- The Gateway client receives a Fetch implementation and Turnstile token provider from its Host Adapter.
- The Context Pack builder accepts only the live v1alpha4 Procedure and allowlisted Package-relative context; references and scripts require explicit opt-in; dependencies require verified metadata.
- The Procedure Agent orchestrates one bounded proposal request, verifies the exact manifest and validates every model-authored reference; it exposes no file-write or Runtime operation.
- Context Pack size is checked against the serialized JSON envelope in UTF-8 bytes. The initial cap is 128 KiB to leave room for the system prompt and request metadata; oversized input is rejected, never silently truncated.
- No provider API key or model identifier is accepted from the client.
- A request cannot be sent until the caller confirms the Context Pack disclosure.
- ModelProposal is untrusted and validated against a versioned Studio-owned schema.
- The model cannot author source offsets, file paths, candidate YAML, WorkspaceEdit, atomic groups or validation state.
- The Host materializes validated proposals into a frozen Change Set envelope, stamps live document / Package revisions, fixes the write scope to the Procedure, assigns operation IDs and leaves atomic grouping / Compiler validation NOT_RUN until later Host stages.
- Every evidence reference must resolve to an ID in the exact Context Pack manifest supplied by the host.

This is not yet the full Authoring Core. It does not provide the Authoring Editor Tab, compute atomic groups, patch YAML or apply edits. The v1alpha4 Semantic Patch Engine remains a separate Host-owned implementation gate.

## Tests

Run from the repository root:

~~~bash
npm test
~~~

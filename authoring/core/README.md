# AI Authoring Core foundation

This folder contains the first host-neutral model-client and proposal-validation contracts.

## Boundaries

- No imports from VS Code, Theia, DOM, Node-only modules or Cloudflare.
- The Gateway client receives a Fetch implementation and Turnstile token provider from its Host Adapter.
- No provider API key or model identifier is accepted from the client.
- A request cannot be sent until the caller confirms the Context Pack disclosure.
- ModelProposal is untrusted and validated against a versioned Studio-owned schema.
- The model cannot author source offsets, file paths, candidate YAML, WorkspaceEdit, atomic groups or validation state.
- Every evidence reference must resolve to an ID in the exact Context Pack manifest supplied by the host.

This is not yet the full Authoring Core. It does not build Context Packs, orchestrate tasks, compute atomic groups, patch YAML or apply edits. The v1alpha4 Semantic Patch Engine remains a separate Host-owned implementation gate.

## Tests

Run from the repository root:

~~~bash
npm test
~~~

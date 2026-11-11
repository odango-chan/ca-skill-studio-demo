# Skill Language Token Catalog Import

This is the read-only build-time snapshot consumed by the online Monaco semantic-token provider.

- Canonical source: [odango-chan/ca-skills/spec/skill-language-tokens.yaml](https://github.com/odango-chan/ca-skills/blob/6742d4cae65c482accdf74c3cd1daf8350856d52/spec/skill-language-tokens.yaml)
- Canonical repository commit: `6742d4cae65c482accdf74c3cd1daf8350856d52`
- Source blob SHA: `1e91dc1db5e0e15845443edffc810d7a19d734b4`
- Snapshot path: `language/spec/skill-language-tokens.yaml`

Do not edit this snapshot independently. Refresh it from the canonical `ca-skills` source when that contract changes. The catalog defines semantic identities and source selectors; it deliberately contains no theme colors or Monaco-specific token scopes.

The Studio maps stable `ca.*` token IDs to LSP-compatible semantic token type names and maps those types to the shared Studio Light theme. The Compiler and future LSP should consume the same canonical catalog rather than infer semantics from color names or text prefixes.

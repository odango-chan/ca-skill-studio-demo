# Skill Language Token Catalog Import

This is the read-only build-time snapshot consumed by the shared language-layer semantic-token engine at `language/semantic-tokens.mjs`. Both online Monaco and the browser LSP Worker consume that engine; neither maintains a separate token catalog.

- Canonical source: [odango-chan/ca-skills/spec/skill-language-tokens.yaml](https://github.com/odango-chan/ca-skills/blob/6742d4cae65c482accdf74c3cd1daf8350856d52/spec/skill-language-tokens.yaml)
- Canonical repository commit: `6742d4cae65c482accdf74c3cd1daf8350856d52`
- Source blob SHA: `1e91dc1db5e0e15845443edffc810d7a19d734b4`
- Snapshot path: `language/spec/skill-language-tokens.yaml`

Do not edit this snapshot independently. Refresh it from the canonical `ca-skills` source when that contract changes. The catalog defines semantic identities and source selectors; it deliberately contains no theme colors or Monaco-specific token scopes.

The Studio maps stable `ca.*` token IDs to LSP-compatible semantic token type names and maps those types to the shared Studio Light theme. The Compiler and future LSP should consume the same canonical catalog rather than infer semantics from color names or text prefixes.

## Host rendering adapters

The online Studio uses Monaco Standalone, not the VS Code workbench theme service. Monaco 0.57's standalone theme contract builds token styling from `IStandaloneThemeData.rules`; it does not consume the VS Code theme extension's `semanticTokenColors` property, and its standalone theme implementation reports semantic highlighting as disabled.

To keep one palette:

- The installed Studio Light VS Code theme retains the canonical `semanticTokenColors` map for a future/host-provided LSP semantic-token stream.
- The online Monaco adapter converts that same map into Standalone TokenTheme rules and applies AST-derived inline decoration classes. It does not maintain a second color table.
- The online editor also registers the catalog-derived Monaco document semantic-token provider. The decoration adapter is the rendering bridge for Standalone's theme limitation, not a second source of semantic identity.

This PR implements the online Monaco provider and rendering path. It does not add the separate LSP `textDocument/semanticTokens/full` endpoint used by a local VS Code/Theia extension host; that host integration must be implemented and verified separately before claiming local IDE semantic coloring is complete.

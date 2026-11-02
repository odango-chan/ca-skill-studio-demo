# Skill Studio · GitHub Pages browser POC

This standalone browser demo is a **first user-workflow smoke test**, not the final React/X6 product.

It uses the pinned `ca-agent-demo` fixtures already in this repo. The Pages workflow copies the actual `fixtures/baseline/ensure-pdu-session/procedure.yaml` and `establish-pdu-session/procedure.yaml` into its upload artifact after compiling `site/src/studio.ts`.

## Run and edit

- `ensure-pdu-session`: select a node, change the supported scalar field, inspect the diff, apply, Undo/Redo, and export the edited YAML.
- `establish-pdu-session`: Source-only transitional format; the visual scalar editor is disabled.
- Source text editing and imports are entirely browser-local, with explicit diff review.
- No scripts, capabilities, 5GC actions, local filesystem writes, or network uploads of imported sources.
- The flow projection is an indentation-scoped preview, **not YAML 1.2 AST validation or runtime qualification**.

## GitHub Pages

Workflow: `.github/workflows/pages-demo.yml`. Push to `feat/typescript-procedure-designer-spike` triggers compilation and artifact deployment.

One-time owner setup: GitHub repository Settings → Pages → Build and deployment → Source → **GitHub Actions**.

Target (only after a successful GitHub Actions deployment):
https://odango-chan.github.io/ca-skill-studio-demo/

## Known POC gaps

The current visual canvas uses native SVG. **React, AntV X6, ELK, Monaco, and real X6-vs-React-Flow large-graph benchmarks are NOT integrated.** The scale dialog shows synthetic grouping only, not engine performance results. The TypeScript source edits via a conservative line-local patch and does not claim full semantic correctness.

The old Python `packages/skill_studio_poc` remains a separate experiment, not the runtime of this Pages site.

# CA-SL v1alpha5 — Current Skill Studio target / 当前编辑器目标

**Candidate normative source / 当前候选规范正文：** [CA-SL v1alpha5 完整中文单文件规范](skill-language-spec.v1alpha5.zh-CN.md).

- **Language:** `connectionagent.io/v1alpha5` — **PUBLIC REVIEW DRAFT; NOT RELEASED**.
- **Inheritance:** v1alpha5 uses the immutable, frozen v1alpha4 specification as its baseline; Appendix L adds Node-entry Event Wait, typed `wait.output`, TIMEOUT control routing and paired-response boundaries.
- **Normative source pin:** `odango-chan/ca-skills@12a9512a9eae006ad4578daf37ebe0bdf3070642` (PR #61 candidate).
- **Compiler pin:** `odango-chan/ca-skill-compiler@34993dc30b66f4cf7d573cbc81d884c356062a12` (PR #30, WP2 only). v1alpha5 Check covers the current Wait parser/AST slice; Build remains fail-closed until WP3–WP8 are implemented.
- **Compiler / Studio-LSP / Host / Runtime / Integration / Owner / 5GC:** **NOT_QUALIFIED**.

The upstream `docs/skill-language-spec.md` discovery entry has not yet been updated by PR #61. This local file is a non-normative Studio target pointer to the immutable candidate source; it does not publish or freeze v1alpha5.

**Historical frozen language:** [CA-SL v1alpha4](skill-language-spec.v1alpha4.zh-CN.md) remains an immutable published baseline. Skill Studio's active authoring target is v1alpha5 candidate; v1alpha4 is not retained as a parallel product compatibility mode.

This index is non-normative. The v1alpha5 candidate and its conformance obligations remain subject to independent review and release decision.

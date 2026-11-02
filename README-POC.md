# Phase 1 · Round-trip YAML / Typed Patch POC

此目录的 `packages/skill_studio_poc/` 是 Skill Studio 的独立离线原型，**不是 Runtime、不是产品 UI，也不是通用 YAML 重写器**。

运行：

```bash
python -m pip install -e '.[test]'
python -m pytest -q
```

固定源文件在 `fixtures/baseline/`，来源以 `fixtures/baseline/manifest.json` 为准，保持只读，不覆盖原始 Demo。

详见 `docs/reference/phase1-source-poc-report.md`。当前仅验证 `SetScalar`、`AddRoute`、`RenameNode` 的安全文本局部修改。若要求完整 Phase 1，请继续 `InsertSequenceItem`、Manifest Parser 测试、CreatedSession 完整读取和真实 Demo Validator 适配。

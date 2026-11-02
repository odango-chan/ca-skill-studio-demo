# Phase 1 · Round-trip YAML / Typed Patch POC

此目录的 `packages/skill_studio_poc/` 是 Skill Studio 的独立离线原型，**不是 Runtime、不是产品 UI，也不是通用 YAML 重写器**。

运行：

```bash
python -m pip install -e '.[test]'
python -m pytest -q
```

固定源文件在 `fixtures/baseline/`，来源以 `fixtures/baseline/manifest.json` 为准，保持只读，不覆盖原始 Demo。

详见 `docs/reference/phase1-source-poc-report.md`。当前已验证 `SetScalar`、`AddRoute`、`RenameNode` 的安全局部修改，并在合成 `poc-sequence` Profile 上验证受限的 `InsertSequenceItem`。生产 Profile 尚未开放 Phase / Step 结构化编辑。另有 `validator.py` 离线只读 CreatedSession **subset diagnostic adapter**（主业务节点顺序、JIT、阶段操作、Route 和 Reconcile 约束），使用合成测试验证，不代表运行了真实 Demo Validator。下一步仍需在完整 checkout 中消除 Manifest 与 CreatedSession 两项 skip，并与 Demo 原始 Validator 联合比对。

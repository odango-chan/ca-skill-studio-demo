# Phase 1 · Round-trip YAML / Typed Patch POC

此目录的 `packages/skill_studio_poc/` 是 Skill Studio 的独立离线原型，**不是 Runtime、不是产品 UI，也不是通用 YAML 重写器**。

运行：

```bash
python -m pip install -e '.[test]'
python -m pytest -q
```

固定源文件在 `fixtures/baseline/`，来源以 `fixtures/baseline/manifest.json` 为准，保持只读，不覆盖原始 Demo。

详见 `docs/reference/phase1-source-poc-report.md`、`docs/reference/phase1-validator-parity.md` 和 `docs/reference/phase1-editor-session.md`。当前已验证 `SetScalar`、`AddRoute`、`RenameNode` 的安全局部修改，并在合成 `poc-sequence` Profile 上验证受限的 `InsertSequenceItem`。生产 Profile 尚未开放 Phase / Step 结构化编辑。另有 `validator.py` 离线只读 CreatedSession **subset diagnostic adapter**（主业务节点顺序、JIT、阶段操作、Route 和 Reconcile 约束），使用合成测试验证，不代表运行了真实 Demo Validator。Manifest 与完整 CreatedSession Fixture 的离线回归已无 skipped；已使用固定版本上游原始专项 authoring 函数做 13 项对照测试。新增 `session.py` 内存级 Source / Visual 统一编辑事务、Undo / Redo、STALE Projection 与外部冲突阻断，**不包含实际磁盘原子写入**。完整 Demo 的 `make verify` 仍未执行。

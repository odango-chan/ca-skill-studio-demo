# Phase 1 · Round-trip YAML / Typed Patch POC

此目录的 `packages/skill_studio_poc/` 是 Skill Studio 的独立离线原型，**不是 Runtime、不是产品 UI，也不是通用 YAML 重写器**。

运行：

```bash
python -m pip install -e '.[test]'
python -m pytest -q
```

固定源文件在 `fixtures/baseline/`，来源以 `fixtures/baseline/manifest.json` 为准，保持只读，不覆盖原始 Demo。

详见 `docs/reference/phase1-source-poc-report.md`、`docs/reference/phase1-validator-parity.md` 和 `docs/reference/phase1-editor-session.md` 和 `docs/reference/phase1-file-save-poc.md`。当前已验证 `SetScalar`、`AddRoute`、`RenameNode` 的安全局部修改，并在合成 `poc-sequence` Profile 上验证受限的 `InsertSequenceItem`。生产 Profile 尚未开放 Phase / Step 结构化编辑。另有 `validator.py` 离线只读 CreatedSession **subset diagnostic adapter**（主业务节点顺序、JIT、阶段操作、Route 和 Reconcile 约束），使用合成测试验证，不代表运行了真实 Demo Validator。Manifest 与完整 CreatedSession Fixture 的离线回归已无 skipped；已使用固定版本上游原始专项 authoring 函数做 13 项对照测试。新增 `session.py` 内存级 Source / Visual 统一编辑事务、Undo / Redo、STALE Projection 与外部冲突阻断，**不包含实际磁盘原子写入**。新增 `storage.py` 的 POSIX 单文件保守保存原型：父目录 flock、临时文件 fsync、os.replace、目录 fsync、二次读取冲突拒绝；15 项新增测试通过。不会在 Skill Package 下创建锁文件。**对不遵守锁协议的外部编辑器仍不存在真正的 kernel CAS**；Windows 原生和 OS 原生 File Watch 尚未实现。新增 `workspace.py` 的显式 Workspace Polling 和外部私有暂存目录上的同目录批量保存 POC；**多文件替换不是原子提交，部分失败会报告 BatchSaveUncertain**。完整 Demo 的 `make verify` 仍未执行。


本地回归：`PYTHONPATH=packages python -m pytest -q -ra` → **92 passed / 0 skipped**。新一轮具体边界见 [Workspace Watch / Batch Save POC](docs/reference/phase1-workspace-watch-batch.md)。

## 包级一致性与恢复意图（新增离线 POC）

新增 `package_guard.py`（完整 Skill 文件清单与 opaque 文件漂移检测）、`recovery_batch.py`（对已有 `save_batch` 的可选写入前恢复记录）、`test_package_guard.py` 和 `test_recovery_batch.py`。恢复记录存放在包外私有目录，只记录旧/新哈希；部分提交后要求人工核对，**不自动回滚**。详见 [Package Recovery POC](docs/reference/phase1-package-recovery.md)。

本轮 **23 项新增隔离测试通过**，其中 8 项使用模拟批量写入器；上一轮仓库的 92 项测试本轮**未与新增测试合并运行**，不要推断 115 项全量 PASS。真正多文件提交仍非原子操作，单文件临时文件进入包目录的问题也尚未修复。

## 2026-11-02：包外单文件保存与恢复联合测试

`save_session` 已收紧为必须显式提供 `package_root` / `staging_dir`，并复用包外私有同文件系统暂存约束；不再允许写入时创建 Skill 根目录内临时文件。新增 `tests/test_recovery_real_workspace.py` 验证恢复封装与真实 `workspace.save_batch` 的正常和注入失败路径；同步修复 `BatchSaveUncertain` 测试参数。**隔离聚焦回归 33 PASS**，但完整旧/新合并回归仍 NOT_RUN。参见 [单文件保存](docs/reference/phase1-file-save-poc.md) 与 [Package Recovery](docs/reference/phase1-package-recovery.md)。

# Phase 1 · Source / Visual 编辑事务与冲突 POC

**状态：10 项新增事务回归 PASS；内存层 POC，文件持久化 NOT_IMPLEMENTED**

## 目标

使 Source 编辑与 Visual Typed Patch 使用同一个 Working Buffer、同一 Source Revision 和同一 Undo / Redo 历史。外部文件变化必须显式暴露冲突，不能用过期的 Visual 预览修改当前文本。

## 实现

- 核心模块：`packages/skill_studio_poc/session.py`
- 回归：`tests/test_editor_session.py`
- 输入输出均为字符串 / 不可变数据类；**没有磁盘读写、线程、网络或 Skill 执行副作用**。

### 编辑事务

- `EditorSession.open(disk_text, profile)` 初始化保存基线、工作副本和最近可解析源文本。
- `source_edit(new_text)` 允许暂时不合法的 YAML 草稿，并将 Projection 标记为 `STALE` 或 `UNAVAILABLE`；不会拿旧图覆盖新文本。
- `preview_visual(TypedPatch)` 通过 `SourceDocument.preview` 生成 Revision-bound 预览；`apply_visual(Preview)` 重新核对 Patch 和 Revision。
- 每次 Source 或 Visual 修改统一压入一次历史事务；`undo` / `redo` 在两个编辑入口共用历史，编辑新分支后清空旧 Redo。
- `establish-pdu-session` Profile 继续只能做 Source 编辑；仍不具备 Transitional phase 图形写回资格。

### 冲突处理

- `observe_disk(external_text)` 用外部观察文本与最近保存基线精确对照；有差异进入 `CONFLICT`，不丢弃本地 Working Buffer。
- CONFLICT 期间拒绝 Source 编辑、Visual Preview / Apply、Undo / Redo 和 Save Plan。
- `resolve_reload(observed_disk_text)`：调用者显式确认重新载入外部版本，清空历史。
- `resolve_manual(observed_disk_text, resolved_source)`：用户显式提供解决冲突后的文本，保存基线更新为外部观察版本；完成后实际 Save 前必须重新检查磁盘。
- 外部观察已经变化时拒绝用过期内容 Resolve。

### 保存计划（不是磁盘写入）

- `prepare_save(disk_text)` 只核对提供的磁盘观察是否仍匹配保存基线，当前 Source 是否能解析；返回包含预期磁盘 Revision 和拟保存文本的 `SavePlan`。
- `acknowledge_save(plan, persisted_disk_text)` 只在调用方提供与计划完全一致的落盘文本时更新**内存中的**保存基线。
- 此 API **无法证明真实文件发生了原子 Compare-and-Write**。尚无 File Watch、落盘文件锁 / fsync、跨进程并发控制和多文件事务；这些必须在下一阶段实现，不得将其标记为生产 Save PASS。

## 实测

~~~text
PYTHONPATH=packages python -m pytest -q -ra
56 passed / 0 skipped / 0 failed
python -m compileall -q packages tests
PASS
~~~

在先前 46 项离线回归基础上新增 10 项测试，覆盖：

1. Dirty / Save Plan / Undo / Redo；
2. Source 与 Visual 共用历史；
3. 非法 YAML 草稿与 STALE Projection；
4. 陈旧 Preview 拒绝；
5. 外部冲突阻断所有修改及 Save；
6. 外部版本竞争与人工解决；
7. 磁盘回退后清除冲突；
8. Save Plan 的 Revision / 数据一致性；
9. 固定 ensure 源上的 Visual 改名与 Undo；
10. 固定 establish 源上的 Source-only 编辑及 Visual 拒绝。

## 未完成门禁

- 原 Demo 全量 `scripts/validate_docs.py` 和 `make verify`：NOT_RUN（当前环境无法获取完整私有仓库 checkout）。
- 真正的 File Watch + 原子磁盘写入：NOT_IMPLEMENTED。
- 跨文件重命名、引用事务、持久化 Undo / Redo：NOT_IMPLEMENTED。
- Schema / Runtime compatibility、Live 5GC：NOT_PROVEN / NOT_RUN。

EditorSession 仅是可独立验证的内存状态机，不授予任何新的 Visual 编辑资格，也不改变 Skill Package 数据模型。

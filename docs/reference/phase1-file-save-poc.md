# Phase 1 · POSIX 单文件保存 POC

**状态：15 项新增离线回归 PASS · 非生产级单文件持久化**

## 为什么选择父目录锁

SkillContextLoader 的 Host Skill Artifact Digest 会覆盖 Skill 根目录全部文件。若把持久锁文件写到 assurance/ 等目录，会无端改变 Package identity。

因此 `storage.py` 采用 **对已存在父目录加 `fcntl.flock`** 的协作锁，不创建 `*.lock` 或临时元数据文件作为长期 Package 资产。多个遵守本实现的写入者在同一父目录串行保存。

该锁**不能阻止不合作的编辑器**；最后一次内容检查与 `os.replace` 之间仍存在 TOCTOU。不能把它称作 kernel CAS、分布式锁或通用无丢失更新保证。

## 保存步骤

1. 使用严格 UTF-8 和 `O_NOFOLLOW` 打开普通单链接文件；拒绝符号链接、硬链接、损坏编码和超大文件。
2. 获取现有父目录的 POSIX flock；读取文件并核对 inode、mtime、ctime、mode、size。
3. 调用 `EditorSession.prepare_save`；如原文已变或 Source 无法解析，拒绝保存。
4. 在同目录创建临时文件、复制标准 POSIX mode 位、写 UTF-8 并 `fsync` 临时文件。
5. 再次检查原文件内容、inode 与元数据；发现外部变化则拒绝替换，清理临时文件。
6. `os.replace` 实现同文件系统原子可见替换，然后 `fsync` 父目录。
7. 文件确认后调用 `acknowledge_save` 更新**内存保存基线**；保存操作本身不清空 Undo/Redo。

### 故障语义

- 替换前发生错误：本实现不执行替换，尽力删除临时文件；外部进程自行修改的文件不会被回滚。
- `os.replace` 已成功但目录 `fsync` 或内存 Ack 失败：抛出 `FileSaveUncertain`，**不能声称文件已回滚**。调用方必须重新读取磁盘并处理可能的冲突。
- `prepare_save` 的磁盘文本检查与最终校验并不能抵抗完全忽略目录锁、恰好在最后检查后写入的外部编辑器。

## 实测

~~~text
PYTHONPATH=packages python -m pytest -q -ra
71 passed / 0 skipped / 0 failed
python -m compileall -q packages tests
PASS
~~~

本轮新增 `tests/test_storage.py` 的 15 项测试，覆盖原子替换与标准权限、clean save 不重写、外部修改拒绝、手动冲突解决、写入时竞态、替换前故障、替换后目录同步故障、链接与非法 UTF-8、BOM/CRLF、真实 ensure Fixture、副本无损性、非法草稿、安全父目录锁和锁持有检查。完整的固定 Demo Validator / `make verify` 仍未执行。

## 不在本阶段声称的能力

- Windows 原生（当前为 **POSIX-only**；用户若在 WSL2 上使用，需通过 Linux 文件系统与真实工作路径验证）。
- 不遵守锁协议的第三方编辑器与跨进程严格 CAS。
- 多文件原子事务、跨文件重命名、File Watch、持久化历史。
- 文件 owner、ACL、xattr、硬链接关系和其他全部元数据保持。
- 对真实 5GC / Script / Capability 的执行或验证。

创建 UI 或安装能力之前，需要把保存失败的不确定状态完整暴露给用户，并增加跨平台与多文件测试。
## Later batch-save note

This single-file POC creates a temporary file in the destination directory. During saving, a concurrent Host traversal can observe this temporary file and temporarily change the complete Skill artifact digest. The separate [Workspace polling and batch-save POC](phase1-workspace-watch-batch.md) instead requires a private staging directory outside the Skill package. That batch still performs sequential, not atomic, multi-file replacements.

## 安全修订：单文件包外暂存（2026-11-02）

原 `save_session(path, session)` 在目标目录创建临时文件，即使最终删除，也可能影响并发 Host Artifact Digest 扫描。现在**保存写入必须同时显式提供** `package_root` 与 `staging_dir`；缺少参数直接 `FileSaveRejected`，不再默认写入 Skill 目录。

用法：`save_session(path, session, package_root=skill_root, staging_dir=private_stage)`。暂存目录必须位于包外、与目标位于同一文件系统、归当前用户所有并保持 mode 0700。原 15 项单文件测试已经迁移为明确的包外暂存调用，新增缺失配置、包内目录和写入期间暂存位置保护测试。此项是 **POC API 的显式收紧**，不是兼容旧调用。

聚焦集（含恢复联合测试）本地 **33 PASS、0 skipped**；完整仓库 92 项旧回归没有在本次与新增测试联合执行。文件元数据、非合作写入者竞争及掉电持久化限制仍然存在。

# 核心用户旅程

**状态：Proposed · Authoring-first**

## Journey A：打开并理解 Skill Package

1. 打开 Workspace；
2. 选择 Recent Package / Open Folder / Import Fixture；
3. 在 Package Explorer 浏览实际存在的资产；
4. 打开 SKILL.md 或 Procedure；
5. 在 Visual / Source / Split 之间切换；
6. 从 Node / Binding / Predicate 跳转到对应 Source；
7. 保留当前文件 Tab、光标和画布状态。

成功标准：作者能在一个工作区中理解 Package，同时始终能回到权威源文件。

## Journey B：创建 Skill

后续提供 Blank / Clone Existing 两种入口：

1. 选择 Package 名称和目标 Workspace；
2. 生成最小必需文件；
3. 不自动创建 optional 目录；
4. 编辑 SKILL.md；
5. 按需创建 Contract、Predicate、Procedure 和 Case；
6. 每个资产都由同一 Source / Patch / Diff 模型管理。

创建向导不强制作者接受固定的 Skill 目录或业务模板。

## Journey C：修改 Procedure

1. 打开 procedure.yaml；
2. 在 Visual 选择 Node，或从 Source 定位到语义对象；
3. 在 Inspector 编辑 Node / Operator / Inputs；
4. 在 Route Details 修改 Outcome / Target；
5. 通过 Binding Inspector 查看或编辑来源；
6. 编辑有资格的 Preconditions / Postconditions Steps；
7. 对破坏性操作查看 Impact Preview；
8. 预览 Typed Source Patch 的实际 Diff；
9. Apply 到 Working Buffer；
10. Undo / Redo 或 Save。

Source 和 Visual 修改共享同一 Working Buffer，不生成第二份 Procedure 定义。

## Journey D：从 Source 修改

1. 打开 YAML / Markdown / CEL / Script Source；
2. 编辑原文；
3. 增量解析；
4. 成功时刷新 Visual / Inspector / References；
5. 失败时保留原文，旧 Projection 标记 STALE；
6. 修复后重新生成当前 Projection。

## Journey E：重构跨资产引用

1. 从 Procedure 选中 Binding / Predicate / Child Procedure；
2. 查看 Producer、Consumer 和所有引用者；
3. 选择 Rename / Delete / Rebind；
4. 展示受影响文件和引用；
5. 若无法原子修改所有引用，则不自动批量改写；
6. 保存后重建引用索引。

## Journey F：导入现有 Skill

1. 选择只读来源 Fixture；
2. 预览文件清单；
3. 检查路径、符号链接和越界文件；
4. 记录 source repository、commit、source path；
5. 计算文件和 Package Digest；
6. 用户选择创建本地可编辑 Workspace Copy；
7. 编辑只作用于本地副本，不写回来源仓库。

## 当前不作为主要旅程

Validation Center、Runtime Execution、Qualification Report、Registry / Publishing 和 AI 自动生成完整 Skill 均后置。编辑器只保留必要的 Problems / Inline Diagnostics。

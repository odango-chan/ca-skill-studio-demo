# 核心用户旅程

**状态：Proposed**

## Journey A：浏览和理解 Skill

1. 打开 Skill Library；
2. 按名称 / 类型 / 状态搜索；
3. 打开 Skill Overview；
4. 阅读 Goal、边界、资产列表和依赖；
5. 进入 Procedure 看业务主流程；
6. 点击节点查看阶段、Binding 和相关 Predicate；
7. 从 Inspector 跳转到 Source。

成功标准：用户无需先读完整 YAML，也能建立正确的业务流程理解；需要精确细节时可以回到源文件。

## Journey B：创建 Skill

提供两种候选入口，最终 UX 决策待确认。

### Guided

1. 选择 Blank / Clone / Template；
2. 填写名称、业务目标和适用范围；
3. 创建 Package 必需文件；
4. 编辑 SKILL.md；
5. 创建 Contract；
6. 创建 Predicate；
7. 创建 Procedure；
8. 添加 Cases；
9. 执行 Validation；
10. 保存 Draft / Candidate。

### Advanced

1. 选择 Blank Package；
2. 直接进入 Source Editor；
3. 按需创建资产；
4. 使用 Validation Center 检查。

两种入口必须产生同一套源文件结构和语义，不得产生两种 DSL。

## Journey C：修改 Procedure

1. 打开 Procedure Designer；
2. 搜索并选择节点；
3. 查看节点的 Operation、Preconditions、Postconditions 和 routes；
4. 通过 Inspector 修改字段或打开 Source；
5. 使用 Binding Designer 选择合法数据来源；
6. 查看关联 Predicate 和 Contract；
7. 执行局部静态检查；
8. 查看源文件 Diff；
9. 保存；
10. 完整门禁按需执行。

第一阶段可以先实现图形只读、Source 可编辑；双向图形编辑需等无损 Patch 能力验收后开放。

## Journey D：排查错误

1. 打开 Validation Center；
2. 按 Severity / File / Node 筛选；
3. 选择一条诊断；
4. 跳转到 Source 行或 YAML 路径；
5. 在 Procedure 图上定位相关节点；
6. 查看关联 Binding / Predicate；
7. 修改源文件；
8. 查看 Diff；
9. 重新执行受影响的检查；
10. 旧验证结果按 Digest 标记 Stale。

## Journey E：Case 管理和验收

1. 打开 Case Studio；
2. 查看 Case 是 semantic obligation 还是 executable fixture；
3. 检查 Context、Available Resources 和 Expected Outcome；
4. 查看它覆盖的 Procedure 分支；
5. 若缺少 executable fixture，标记为明确缺口；
6. 在获准的本地测试环境执行；
7. 记录实际 Trace 和结果；
8. 生成与 Source Digest 绑定的 Qualification Report。

## Journey F：导入现有 Skill

1. 选择本地 Package 或指定来源仓；
2. 预览文件清单；
3. 检查路径、符号链接和越界文件；
4. 记录 source repository、commit、source path；
5. 计算每个文件和整个 Package 的 Digest；
6. 作为独立 Workspace / Fixture 打开；
7. 明确显示来源版本和是否有本地修改。

导入不应自动写回源仓。Export / Commit 是单独且明确的操作。

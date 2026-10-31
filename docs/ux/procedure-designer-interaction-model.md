# Procedure Designer Interaction Model

**状态：Proposed · 双向编辑交互规范**

本文件定义 Procedure Designer 的选择、编辑、同步、事务、撤销和冲突行为。底层规则见 [Source-preserving Edit Model](../architecture/source-preserving-edit-model.md)。

## 1. 页面状态模型

### 1.1 Source state

| 状态 | 含义 | 行为 |
|---|---|---|
| CLEAN | 与已保存版本一致 | 正常编辑 |
| DIRTY | Working Buffer 有修改 | 显示未保存 |
| SAVING | 正在保存 | 防止重复保存 |
| CONFLICT | 外部文件变化 | 保留本地编辑，Compare / Reload / Resolve |
| INVALID | Source 无法解析 | 保留原文，Graph 标记 STALE |

### 1.2 Projection state

READY、PARTIAL、STALE、UNAVAILABLE。Projection 始终绑定某个 Working Revision；不能把旧 Graph 当成当前 Source。

### 1.3 Edit capability state

每个 Node / Field / Phase 显示 editable、source-only、preserve-only 或 unavailable。同一文件中允许不同区域拥有不同编辑资格。

### 1.4 Selection state

Procedure、Node、Route、Phase、Step、Binding、Predicate、Diagnostic。Selection 必须同步到 Inspector 和 Source location。

## 2. 选择与导航

- 单击 Node：选中并打开 Inspector；
- 双击 Child Procedure：进入独立子图；
- 单击 Route：显示 Route Source、Outcome、Target、Source Location；
- 从 Phase / Step 列表选择：高亮阶段和源位置；
- 从 Binding 选择：高亮 Producer / Consumer 并支持双向跳转；
- Source 光标位于可解析对象时同步 Visual selection；
- 未知字段不强行映射到近似对象。

## 3. Source / Visual / Split 同步

### Visual → Source

选择对象会定位 Source；编辑操作通过 Typed Patch 更新 Source Working Buffer，并显示 Diff。

### Source → Visual

Source 修改后增量解析；成功时刷新 Semantic Model / Visual；失败时保留 Source 并标记旧 Projection STALE。

### Split

Source 和 Visual 同时可编辑，但共用一个 Working Buffer、Revision 和事务历史。不存在两个独立文档之间的双向合并。

## 4. Node 编辑

### 新建

1. 点击 + Node；
2. 选择当前 Profile 可结构化编辑的 Operator；
3. 输入 Node ID；
4. 检查唯一性和 Operator 必需字段；
5. 创建 Draft Node；
6. 显示 Source Patch / Diff；
7. Apply 到 Working Buffer。

Draft 可以语义未完成，但 Source 必须保持可解析；缺少必填字段由 Problems 显示，不伪装成完整 Node。

### 编辑

- Inspector 字段编辑实时更新 Working Buffer；
- 单字段修改形成可合并的事务；
- 切换 Operator 时显示旧字段移除 / 保留 / 转换清单；
- 未知字段不得自动删除；
- 不支持 Operator 只能 Source 编辑。

### 重命名

重命名先扫描 start、Route target、Binding producer path、Child Procedure 和跨资产引用。第一版若不能安全原子更新所有引用，则拒绝批量 Rename，仅提供影响清单和 Source 导航。

### 删除

显示入边、出边、Binding 和外部引用。只有用户明确选择处理方式且 Patch 可原子应用时才允许删除。不能留下静默 Dangling Reference。

## 5. Route 编辑

- 从具体 Route Source 的锚点创建连接；
- 新建 Route 时明确选择 Operator / Preconditions / Postconditions / Child Procedure 来源；
- Outcome 只能从 Profile 已知集合中选择；未知值保留 Source-only；
- Target 只能选择当前 Procedure 中存在的 Node；
- Route entry 在源映射中保持独立；画布 bundle 仅是视觉呈现；
- 删除 Route 前显示可能不可达的 Node / Terminal 影响，但不自动重写其他路径。

## 6. Phase / Step 编辑

- Inspector 中按源顺序列出 Step；
- 支持已具备 Profile 资格的 Step 增加、编辑、删除和拖动排序；
- Step reorder 是语义修改，生成 Sequence Patch；
- 画布 Node 拖动只改 UI layout，不改变 Step 顺序；
- Phase aggregate route 和 Step Operator outcome 独立编辑；
- CreatedSession Transitional phase 在专用 Round-trip Profile 未通过前保持 Source-only。

## 7. Binding 编辑

1. 选中 Consumer field；
2. 查看原始 expression；
3. Producer Picker 只显示已解析且类型 / 来源明确的候选；
4. 选中后显示完整 Patch / Diff；
5. 应用后重新解析 Producer / Consumer；
6. 无法确定类型或生产时机时，允许 Source 手动编辑，不提供猜测式 Picker。

跨文件引用修改必须展示所有消费者；第一版没有原子多文件事务时不自动批量修改。

## 8. Typed Patch 与事务

每个 Visual 命令都携带 Source Revision、Semantic Target、Expected Old Value / Structure Fingerprint、Compatibility Profile 和 Patch operation。

事务顺序：

1. Resolve target；
2. Check edit capability；
3. Check source revision / preconditions；
4. Build Typed Patch；
5. Build impact preview if needed；
6. Apply to temporary Round-trip Tree；
7. Serialize only touched region；
8. Reparse and compare intended semantic result；
9. Verify untouched source regions；
10. Show Diff；
11. Apply to Working Buffer。

任何步骤失败，整个事务回滚。

## 9. Undo / Redo / Save

- 一次 Visual 命令为一个 Undo transaction；
- Source typing 按编辑器边界合理分组；
- 复合引用更新是一个原子事务；
- Undo / Redo 跨 Source 和 Visual 共用历史；
- Save 只写本地工作副本；
- Save 不触发 Git commit / push、PR、发布或安装。

## 10. Conflict

检测到外部文件 Digest 变化：

- 标记 CONFLICT；
- 保留本地 Working Buffer；
- 显示本地 / 磁盘 Diff；
- 提供 Reload 或人工 Resolve；
- 不自动覆盖磁盘；
- Resolve 后重新解析并重建 Patch history。

## 11. Inline Problems

显示 Parse、Duplicate ID、Dangling Route、Unresolved Binding、Unsupported Syntax、Compatibility Profile 限制和 External Conflict。

Problems 是作者辅助，不等同于完整 Schema / Runtime compatibility 验收。

## 12. 键盘与可访问性

- Node / Route / Step / Binding 可键盘访问；
- Canvas 提供 Node Outline 和 Route List 线性替代；
- Enter 选择 / 打开，Delete 进入影响预览，Escape 取消；
- Ctrl/Cmd+S 保存；Ctrl/Cmd+Z 撤销；Ctrl/Cmd+Shift+Z 重做；
- 所有状态有文字表达，不只依赖颜色；
- 快捷键实现前检查浏览器 / OS 冲突。

## 13. 样本驱动编辑验收

- ensure：编辑 Node 属性、Add Route、Update Route、Delete Route、Undo / Redo、Diff；
- establish：17 Root Node、65 Route entries、5 Child Procedure 正确读取；Transitional phases 在未资格化前 Source-only；
- 所有编辑操作保持源文件未触及区域不变；
- 不执行 Script、Capability、Runtime 或 Live 5GC。

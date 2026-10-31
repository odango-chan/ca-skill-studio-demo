# ADR-0005：Source-preserving 双向编辑模型

- 状态：Proposed
- 日期：2026-10-31
- 取代：ADR-0004 中“Visual 只读、图形编辑后置”的阶段性建议；不取代 Source 为唯一权威源的 ADR-0001。

## 背景

用户确认 Skill Studio 的主要用途是 Skill 开发和编辑。Procedure Designer 不能长期停留在只读流程图；作者需要从 Source 或 Visual 修改同一份 Skill。

但当前 Demo 的 YAML 包含注释、顺序约束、on 字符串键、未知字段，以及 CreatedSession 专用过渡语法。若 Visual 直接修改内存 Graph 再全量 dump YAML，可能丢失格式、未知语法或源文件语义。

## 决策建议

采用 **Source-authoritative + Round-trip Tree + Typed Source Patch**：

1. Package Source 是唯一权威定义。
2. Round-trip Tree / CST 保留原始语法和格式。
3. Typed Semantic Model 只用于投影、导航和 Patch 前置条件。
4. Visual / Inspector 修改生成 Typed Source Patch。
5. Patch 在临时 Tree 中应用，只序列化目标区域。
6. 重新解析、检查语义结果和未修改区域，再展示 Diff。
7. 用户确认后更新 Working Buffer；Save 才写入本地文件。
8. Source 与 Visual 使用同一事务历史，支持 Undo / Redo。
9. 未建立 Round-trip / Patch 资格的语法保持 Source-only / Preserve-only。

## 编辑事务要求

每个 Patch 必须绑定 Source Revision、目标语义路径、预期旧值 / 结构指纹、操作类型、兼容性 Profile 和逆操作。Patch 过期、目标结构变化或解析验证失败时必须拒绝并回滚。

删除、重命名和跨文件引用更新必须显示 Impact Preview。不能自动猜测 Binding Producer 或替用户选择语义目标。

## 当前交付顺序

- 先完成 ensure-pdu-session 的 YAML Round-trip POC 和有限 Typed Patch；
- establish-pdu-session 先作为复杂读取 / 无损保存兼容性样本；
- CreatedSession node-level Preconditions / Postconditions 只有在专用 Profile 的 Parser、Patch、Round-trip 和 Demo Validator 测试全部通过后才开放结构化编辑；
- 其他资产编辑器复用同一 Source / Patch / Diff / History 模型。

## 技术选型

本 ADR 不锁定 UI 框架、Graph Library 或 YAML Parser。Round-trip POC 是技术选型前置条件。

## 后果

- Visual 与 Source 都成为正式编辑入口，但 Source 仍然权威；
- 图形编辑不是任意画图，而是受 Compatibility Manifest 约束的语义操作；
- 需要额外的 CST、Patch、Revision、History 和 Conflict 模块；
- 不支持语法不会因为编辑器能力不足而被静默丢弃；
- 应用脚手架和 UI 技术选型推迟到 Round-trip POC 通过之后。

# ConnectionAgent Skill Studio Demo

ConnectionAgent Skill 的独立开发与编辑原型。在线 Pages 托管的是**无后端的浏览器前端**，不是 Agent Runtime。

## 在线预览

https://odango-chan.github.io/ca-skill-studio-demo/

当前实现（Stage: Procedure source projection preview）：

- 从固定的 Demo ensure-pdu-session Procedure YAML 文件即时投影 Control Flow；显示准确的 Node / Route entry 数量、原始 Operator、Outcome、Target。
- Visual / Source / Split 三视图；画布支持平移、缩放、适配；Node Outline 搜索及按源码顺序导航；点击节点/边查看 Inspector 和 Source 行。
- 支持导入本地文本文件、直接编辑 Source、重置本地缓冲区、导出文件。
- 对未知或不支持的 Procedure 结构**拒绝重新投影**；若原有可用视图存在，会显示 STALE 警告。不会把旧图伪装成新 YAML 的正确语义。
- 不上传用户文件、不调用 Capability、不执行 Skill 或 Script，不进行发布。

## 边界和兼容性

**这是有限 ensure-subset 文本投影器，不是全量 YAML Parser。** 其静态检查只针对固定样本中的简化 Procedure / node / on 形式，不能据此声称通用 Schema、Runtime 或 Validated Authoring PASS。其他文件（SKILL.md、JSON、复杂 YAML、多 Procedure、CreatedSession Transitional phases）仍可 Source-only 编辑；不承诺这些文件获得图形投影。

Visual 当前只可**选择、导航和检查**，不能结构化添加、重命名或删除节点/Route。真正的视觉修改应先经过 Typed Patch、Revision Guard、Source Diff、Round-trip、语义复核和 Compatibility Profile 测试，再向 UI 开放。来源不明的节点或字段不猜测、不自动全量重写 YAML。

导出是浏览器下载请求，**不是本地原文件的原地或原子 Save**。浏览器 textarea 可能规范化 CRLF；当前不承诺逐字节文件保真、完整 Source map 或跨文件事务，重要文件应自行比对 Diff 后再替换。此站点不与 packages/skill_studio_poc/ Python POC 通信。

样本来源：ca-agent-demo@bf445ad777149af5af2dfa0a5bdea18d0451303e 的 skills/ensure-pdu-session/assurance/procedure.yaml，来自本仓 PR #2 的固定 Fixture。完整 Demo 与 Live 5GC 验证 **NOT_RUN**。

## Actions / Pages

.github/workflows/pages.yml 支持 push main 的静态站点变更自动部署以及 workflow_dispatch 手动触发。Build Job 使用 Node 24 检查浏览器模块语法并运行 Node 原生回归测试（无需 npm 安装），通过后上传 site/ 静态文件到 Pages。

- [Actions](https://github.com/odango-chan/ca-skill-studio-demo/actions/workflows/pages.yml)
- [PR #1 · UX / Architecture](https://github.com/odango-chan/ca-skill-studio-demo/pull/1)
- [PR #2 · Python Typed Patch POC](https://github.com/odango-chan/ca-skill-studio-demo/pull/2)

两条 PR 在此阶段保持独立、未自动合并。

## 下一阶段

先推进带真实 YAML 解析与 Source Map 的 TypeScript 编辑核心，再逐项让确保无损的 Typed Patch 成为 Visual 可编辑操作。在图形层选型上，大图和可编辑连接线优先评估 React + TypeScript + React Flow / ELK，**本次上线的 Canvas 是无依赖 SVG 预览，不等于已选型或完成正式 Visual 编辑器**。

当前只建设 SKILL 开发与编辑，不做 Case、独立验证工作台、Registry / Publishing、Agent Runtime 调用或 Live 5GC。

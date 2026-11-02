# ConnectionAgent Skill Studio Demo

ConnectionAgent Skill 的独立开发与编辑原型。在线 Pages 托管的是**无后端的浏览器前端**，不是 Agent Runtime。

## 在线预览

https://odango-chan.github.io/ca-skill-studio-demo/

当前实现（Stage: guarded SetRouteTarget patch preview）：

- 从固定的 Demo ensure-pdu-session Procedure YAML 文件即时投影 Control Flow；显示准确的 Node / Route entry 数量、原始 Operator、Outcome、Target。
- Visual / Source / Split 三视图；画布支持平移、缩放、适配；Node Outline 搜索及按源码顺序导航；点击节点/边查看 Inspector 和 Source 行。
- 支持导入本地文本文件、直接编辑 Source、重置本地缓冲区、导出文件。
- **第一条 Visual 编辑纵切**：Inspector 只允许对固定 ensure 结构中的 verify-created-target.FAIL 和 observe-session-absence.FAIL 修改目标为已有的失败/未决/安全停止 Terminal；必须 Preview 真实单行 Source Diff → Apply 到当前 Working Buffer → 导出。其他 Route 仍只读。
- Source 修改与此受限 Visual Patch 共用**有上限的内存 Undo / Redo 历史**；每次 Source 输入事件视作独立事务，尚无打字分组或持久历史。
- 对未知或不支持的 Procedure 结构**拒绝重新投影**；若原有可用视图存在，会显示 STALE 警告。不会把旧图伪装成新 YAML 的正确语义。
- 不上传用户文件、不调用 Capability、不执行 Skill 或 Script，不进行发布。

## 边界和兼容性

**这是有限 ensure-subset 文本投影器，不是全量 YAML Parser。** 其静态检查只针对固定样本中的简化 Procedure / node / on 形式，不能据此声称通用 Schema、Runtime 或 Validated Authoring PASS。其他文件（SKILL.md、JSON、复杂 YAML、多 Procedure、CreatedSession Transitional phases）仍可 Source-only 编辑；不承诺这些文件获得图形投影。

Visual 目前支持**两条固定失败终态 Route 的实验性 SetRouteTarget**，其他对象仍只读。Patch 会精确定位单行标量、绑定原 Source 文本 Revision、重新解析并比对节点和 Route 投影、保留不相关源文本。Preview 如果过期或被修改会拒绝应用。**这不等于完整 YAML CST Round-trip 或 Demo Validator 通过**，也不意味着已接入 Python POC；语义安全仍需人工检查。未知字段和复杂结构不能凭 Graph 自动修改。

导出是浏览器下载请求，**不是本地原文件的原地或原子 Save**。浏览器 textarea 可能规范化 CRLF；当前不承诺逐字节文件保真、完整 Source map 或跨文件事务，重要文件应自行比对 Diff 后再替换。此站点不与 packages/skill_studio_poc/ Python POC 通信。

样本来源：ca-agent-demo@bf445ad777149af5af2dfa0a5bdea18d0451303e 的 skills/ensure-pdu-session/assurance/procedure.yaml，来自本仓 PR #2 的固定 Fixture。完整 Demo 与 Live 5GC 验证 **NOT_RUN**。

## Actions / Pages

.github/workflows/pages.yml 支持 push main 的静态站点变更自动部署以及 workflow_dispatch 手动触发。Build Job 使用 Node 24 检查浏览器模块语法并运行 Node 原生图形投影与 Typed Route Patch 回归测试（无需 npm 安装），通过后上传 site/ 静态文件到 Pages。

- [Actions](https://github.com/odango-chan/ca-skill-studio-demo/actions/workflows/pages.yml)
- [PR #1 · UX / Architecture](https://github.com/odango-chan/ca-skill-studio-demo/pull/1)
- [PR #2 · Python Typed Patch POC](https://github.com/odango-chan/ca-skill-studio-demo/pull/2)

两条 PR 在此阶段保持独立、未自动合并。

## 下一阶段

逐步替换有限文本投影器，接入真正的 YAML CST / Source Map、Demo Schema 与专用 Validator 的可执行一致性检查，才能扩展 Node 创建、删除、Route Add/Rename、复杂 Procedure 的 Visual 编辑。在图形层选型上，大图和可编辑连接线优先评估 React + TypeScript + React Flow / ELK，**本次上线的 Canvas 是无依赖 SVG 预览，不等于已选型或完成正式 Visual 编辑器**。

当前只建设 SKILL 开发与编辑，不做 Case、独立验证工作台、Registry / Publishing、Agent Runtime 调用或 Live 5GC。

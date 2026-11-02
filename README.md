# ConnectionAgent Skill Studio Demo

ConnectionAgent Skill 的独立开发与编辑原型。在线 Pages 托管的是**无后端的浏览器前端**，不是 Agent Runtime。

## 在线预览

https://odango-chan.github.io/ca-skill-studio-demo/

当前实现（Stage: Multi-Procedure read-only explorer + bounded ensure SetRouteTarget）：

- 从固定的 Demo ensure-pdu-session 和 establish-pdu-session 的真实 YAML 文件投影 Control Flow；显示准确的 Node / Route entry 数量、原始 Operator、Outcome、Target。
- CreatedSession 样本支持 Root 和 5 个 Child Procedure 的下钻与返回，保留 Node 顺序和 Route Source（operator / preconditions / postconditions）；Phase Step 在 Inspector 按顺序展示，不把局部过程冒充业务 Node。
- Visual / Source / Split 三视图；画布支持平移、缩放、适配；Node Outline 搜索及按源码顺序导航；点击节点/边查看 Inspector 和 Source 行。
- 支持导入本地文本文件、直接编辑 Source、重置本地缓冲区、导出文件。
- **第一条 Visual 编辑纵切**：Inspector 只允许对固定 ensure 结构中的 verify-created-target.FAIL 和 observe-session-absence.FAIL 修改目标为已有的失败/未决/安全停止 Terminal；必须 Preview 真实单行 Source Diff → Apply 到当前 Working Buffer → 导出。其他 Route 仍只读。
- Source 修改与此受限 Visual Patch 共用**有上限的内存 Undo / Redo 历史**；每次 Source 输入事件视作独立事务，尚无打字分组或持久历史。
- 对未知或不支持的 Procedure 结构**拒绝重新投影**；若原有可用视图存在，会显示 STALE 警告。不会把旧图伪装成新 YAML 的正确语义。
- 不上传用户文件、不调用 Capability、不执行 Skill 或 Script，不进行发布。

## 边界和兼容性

**图形投影基于 yaml@2.9.1 的 YAML 1.2 Document AST / CST source tokens 与 LineCounter，当前具有单 Procedure 写回 Profile 和多 Procedure 只读 Profile，并非完整 Demo Schema / Runtime 校验。** 它拒绝重复键、Alias / Anchor / Tag、额外 Procedure、未资格化的 Phase 和不安全语法；不支持跨文件语义。其他文件（SKILL.md、JSON、复杂 YAML、多 Procedure、CreatedSession Transitional phases）仍可 Source-only 编辑；不承诺这些文件获得图形投影。

Visual 目前仅在 ensure 单 Procedure 的**两条固定失败终态 Route**支持实验性 SetRouteTarget。**CreatedSession 多 Procedure 的所有 Node / Route / Phase 均只读**；其余对象也只读。Patch 使用 YAML Scalar.range 确定真实 Source Span，只替换目标标量，绑定完整源文本 Revision、重新解析并比对全部 Node 和 Route 投影、冻结其余 22 条路由目标，保留所有未触及文本及注释。Preview 如果过期或被修改会拒绝应用。**这不等于完整 YAML CST Round-trip 或 Demo Validator 通过**，也不意味着已接入 Python POC；语义安全仍需人工检查。未知字段和复杂结构不能凭 Graph 自动修改。

导出是浏览器下载请求，**不是本地原文件的原地或原子 Save**。浏览器 textarea 可能规范化 CRLF；当前不承诺逐字节文件保真、完整 Source map 或跨文件事务，重要文件应自行比对 Diff 后再替换。此站点不与 packages/skill_studio_poc/ Python POC 通信。

样本来源：ca-agent-demo@bf445ad777149af5af2dfa0a5bdea18d0451303e 的 skills/ensure-pdu-session/assurance/procedure.yaml，来自本仓 PR #2 的固定 Fixture。完整 Demo 与 Live 5GC 验证 **NOT_RUN**。

## Actions / Pages

.github/workflows/pages.yml 支持 push main 的静态站点变更自动部署以及 workflow_dispatch 手动触发。Build Job 使用 Node 24 安装固定版本 yaml@2.9.1 和 esbuild@0.28.2，执行 YAML CST / Typed Route Patch 回归测试，构建浏览器端 bundle（dist/），并发布 dist/ 到 Pages。package-lock.json 已从通过的 CI 构建原样归档到仓库，后续统一使用 npm ci 进行锁定依赖安装。

- [Actions](https://github.com/odango-chan/ca-skill-studio-demo/actions/workflows/pages.yml)
- [PR #1 · UX / Architecture](https://github.com/odango-chan/ca-skill-studio-demo/pull/1)
- [PR #2 · Python Typed Patch POC](https://github.com/odango-chan/ca-skill-studio-demo/pull/2)

两条 PR 在此阶段保持独立、未自动合并。

## 下一阶段

下一阶段优化大图自动排版（评估 ELK / React Flow）、提供 Child 返回路径与局部图折叠，并引入完整 Demo Schema / 专用 Validator 的可执行一致性检查。获得新的 Typed Patch 编辑资格之前，复杂 CreatedSession 仍坚持只读。在图形层选型上，大图和可编辑连接线优先评估 React + TypeScript + React Flow / ELK，**本次上线的 Canvas 是无依赖 SVG 预览，不等于已选型或完成正式 Visual 编辑器**。

当前只建设 SKILL 开发与编辑，不做 Case、独立验证工作台、Registry / Publishing、Agent Runtime 调用或 Live 5GC。

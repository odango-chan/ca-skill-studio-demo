# ConnectionAgent Skill Studio Demo

ConnectionAgent Skill 的独立开发与编辑原型。在线 Pages 托管的是**无后端的浏览器前端**，不是 Agent Runtime。

## 在线预览

https://odango-chan.github.io/ca-skill-studio-demo/

当前实现（Stage: UX Trim — minimalist single-file Procedure workbench + bounded editing）：

- 从固定的 Demo ensure-pdu-session 和 establish-pdu-session 的真实 YAML 文件投影 Control Flow；显示准确的 Node / Route entry 数量、原始 Operator、Outcome、Target。
- CreatedSession 样本支持 Root 和 5 个 Child Procedure 的下钻与返回，保留 Node 顺序和 Route Source（operator / preconditions / postconditions）；Phase Step 在 Inspector 按顺序展示，不把局部过程冒充业务 Node。
- **UX Consolidation**：删去重复的 Node Quick Card 和独立 Inspector 开关。单击 Node / Route 直接进入唯一的上下文 Inspector；关闭后回到宽画布。布局方向、标签策略、邻居焦点与缩放合并进单个 View 菜单。
- **UX Trim 信息减负**：移除重复的编辑器标题 / 文件状态、空 Problems 与运行时说明、重复计数和 Canvas 状态浮层；文件名与未导出修改只在顶栏显示，Procedure 面包屑与 Visual / Source / Split 合为一条紧凑工具栏。仅显示真正存在的 Preconditions / Postconditions / Routes，Node Inspector 默认以 Operator 和可折叠信息为主。Sample 与 Node Outline 按需展开，必要的 Source 错误与 Patch Diff 保留。
- **资产优先的左栏（诚实范围）**：只列出当前确实加载的 YAML 文件；固定 Procedure 样本在 assurance/ 下，Local 文件不伪造 Package 路径。Root / Child Procedure 是文件内部视图，Node Outline 默认为折叠的线性导航。**完整 Skill Package 尚未加载，绝不显示假的 SKILL.md / Contract / Predicate。**
- **Inspector 统一入口**：准备、执行、确认、路由在一个上下文面板中，低频内容默认折叠；Phase Step 与 Route 仍保留原始 Source 路径和行号；只读与可编辑资格严格分离。
- 文件导出、Undo / Redo、Procedure Explorer、搜索、Root / Child 路径和 Visual / Source / Split 继续存在，保留旧的固定 ensure Route Patch 安全边界。
- **ELK layered 自动布局**：从左到右 / 从上到下切换、正交边路径、画布平移缩放和适配；Node Outline 选择后自动居中；相邻视图只显示所选 Node 的入边/出边一跳，不改写 Source。
- **按 Route Source 分组而非语义合并**：画布上的连线按 `source + target + routeSource` 分组；点击同一组连线可轮流定位每个原始 Route，在 Inspector 查看原始 outcome、target、line；Phase 的 on 路由不与 Operator 的 on 混淆。ELK 失败时退回旧布局，并显示状态。
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

.github/workflows/pages.yml 支持 push main 的静态站点变更自动部署以及 workflow_dispatch 手动触发。Build Job 使用 Node 24 安装固定版本 yaml@2.9.1、elkjs@0.12.1 和 esbuild@0.28.2，执行 YAML CST / Typed Route Patch / ELK 布局回归测试，构建自包含浏览器 bundle（dist/），并发布 dist/ 到 Pages。package-lock.json 已与成功构建的 GitHub Actions 产物进行字节级 Git Blob SHA 对比并固定入库，流水线使用 npm ci 安装精确依赖。package-lock.json 已从通过的 CI 构建原样归档到仓库，后续统一使用 npm ci 进行锁定依赖安装。

- [Actions](https://github.com/odango-chan/ca-skill-studio-demo/actions/workflows/pages.yml)
- [PR #1 · UX / Architecture](https://github.com/odango-chan/ca-skill-studio-demo/pull/1)
- [PR #2 · Python Typed Patch POC](https://github.com/odango-chan/ca-skill-studio-demo/pull/2)

两条 PR 在此阶段保持独立、未自动合并。

## 下一阶段

下一阶段为真实浏览器 E2E 交互验收、选中节点的分支折叠与复杂回边标签避让，并评估是否有足够收益迁移 React Flow。随后接入完整 Demo Schema / 专用 Validator 的可执行一致性检查。获得新的 Typed Patch 编辑资格之前，复杂 CreatedSession 仍坚持只读。在图形层选型上，大图和可编辑连接线优先评估 React + TypeScript + React Flow / ELK，**本次上线仍使用 SVG 画布 + ELK 布局，而非 React Flow 的正式编辑器；ELK 只负责视觉位置与边路由，不改变 YAML 语义**。

当前只建设 SKILL 开发与编辑，不做 Case、独立验证工作台、Registry / Publishing、Agent Runtime 调用或 Live 5GC。

## UX Consolidation 实现边界

- Explorer 的 Procedure 树与 Node 列表只从当前解析投影生成；任何无法安全投影的 Source 都禁用图形选择与编辑。
- Inspector 的四阶段 Journey 纯属 UI 视图，**不改变 SKILL YAML 结构或引入新语法**，点击 Step 会定位真实 Source 行。
- 文件状态表示是否与本次打开时的文本相同；导出触发浏览器下载，不是直接保存回原文件，也不会替用户标记为已保存。
- 界面元素和投影模型由静态 / 模型层回归检查；真实鼠标、键盘、辅助技术及手机交互浏览器 E2E 仍需单独验收。

UX Consolidation 的自动化测试覆盖 View 菜单与单一 Inspector 控件、Node Journey 语义投影、Route Source 隔离和 Source Patch 边界。**真实浏览器 E2E、视觉截图与可访问性测试仍为 NOT_RUN**，部署成功不应等同于这些验收完成。

参见 [UX Consolidation / 与原始设计对照](docs/ux/ux-consolidation.md)。原始 authoring-first 设计仍在未合并的 [PR #1](https://github.com/odango-chan/ca-skill-studio-demo/pull/1)，当前单文件 Demo 不等于完整 Skill Package IDE。

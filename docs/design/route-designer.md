# D3 Route Designer · bounded source-backed authoring

**Status: Proposed overall · Date: 2026-11-03**  
**Implementation: A1 IMPLEMENTED on main; A2 PR #11 candidate; A3 NOT_STARTED**  
**Acceptance: A1 PASS (editor tier); A2 PR CI PASS (editor tier); A3 NOT_RUN**  
**Tracking: [Issue #7](https://github.com/odango-chan/ca-skill-studio-demo/issues/7)**

本页是新阶段**候选设计**，不能当成已经允许全部 Route 修改或 Runtime 验收通过。

## Objective

在当前 YAML 真实 `on` mapping 中**受限地新增 / 重命名 / 删除 Outcome → Node**，图形手势只负责提出变更。先做 AST + Typed Patch + Diff + 单元回归，再开放画布交互。不自动创建 Node、Phase Step 或独立 graph definition。

## Identity / origin

以 `site/workspace.mjs` 为准：

| Source position | routeSource | Projected route ID |
|---|---|---|
| `nodes.<node>.'on'` | `operator.on` | `<node>:<outcome>` |
| `nodes.<node>.preconditions.'on'` | `preconditions.on` | `<node>:preconditions:<outcome>` |
| `nodes.<node>.postconditions.'on'` | `postconditions.on` | `<node>:postconditions:<outcome>` |

每一条 Route 保留 source、target、outcome、routeSource、line/sourceSpan。相同 source-target 可显示为 visual bundle，但不同 routeSource **永不合并业务语义**；有多个 Outcome 时必须明确选定一条，不能自动猜。

## Work slices

| Slice | Proposed capability | Proof before enabling |
|---|---|---|
| D3-A1 | 对已有、合格的 `on` map 追加单个 Outcome 和当前 Procedure 现存目标 | 没有重名 Outcome、源 map/缩进唯一、非 terminal、源文不相关 bytes 不变；负面测试 |
| D3-A2 | 修改现存 Outcome key 或删除一条 Route | 不产生重复 ID、悬空 target、非终态无 Route；必须有影响与负面检验 |
| D3-A3 | 用 React Flow 新连线 / 重连提出受限 A1/A2 预览 | 只能 Preview，不能拖动即保存；确认后 Source 修改、取消不变、Undo/Redo 可逆 |

初版不自动创建缺失的 `on` map，也不在没有独立 Profile 证据时任意开放 Phase-specific 新路由；Step 和业务主干节点保持区分。

## Patch contract

1. 从**当前** Source 重新解析 YAML 1.2 AST/CST，锁定 `procedureId/nodeId/routeSource/outcome` 与完整文本 revision；不能以 React Flow Edge JSON 作为修改权限。
2. 验证目标 Node 属于当前 Procedure，terminal 不出边，Outcome key 不重复；源结构不含无法无损修改的 quoted/Anchor/Alias/duplicate/未知语法。
3. 生成对**一个明确 map entry**的精确源文本增删改。只编辑经确认的 span，不全文件 dump，不动其他 Procedure/Node/Phase/Binding/注释。
4. 重新投影并核验全部无关对象不变；Diff 预览列出 origin/outcome/target，必须在 Apply 前再次核对 revision 和 patch。
5. Source 变动或结构不合法 fail closed，保持原文；Undo/Redo 恢复 Source、Route ID 和选择，没有 stale graph。
6. 单测与 Chromium 的 Passed 仅验证编辑器，**不等于** Runtime 允许相应 Outcome 语义。

## Required negative cases

Duplicate Outcome；operator 和 Phase 的相同 Outcome 被错配；最后一条 nonterminal Route 删除；terminal 出边；缺失/跨 Procedure target；quoted key 或 target；Anchor/Alias、重复键、未知 Phase、超过 1600 Route；Source 被中途编辑/过时 Diff；多 Outcome bundle 未明确选择；评论/空行/缩进发生非目标重写；Root/Child 导航/大图降级、现有 Route Rewire 回归。

## Review decisions still open

- Outcome 名称、Outcome State 合法性应从对应 Demo Schema / Operator 语义得出，不能仅因 YAML parser READY 就放行；缺 owner 合同先限定 subset。
- Phase `on` 的具体规则与局部 `steps`/postcondition verdict 的映射需单独确认，不能默认为 Operator 的同类 Outcome。
- 删除可能影响引用或下游消费；无法证明影响范围的语义必须 Source-only / Editor Warning，不能用 UI 猜测 Runtime 结果。

D3-A1 的保守 Operator 子集已落地并通过浏览器测试；D3-A2 仅属于候选 PR #11。D3-A3 和 Runtime Outcome 合法性验证尚未实现，也没有 Live PASS。

## D3-A1 implemented on main (PR #10)

**Merged:** [PR #10](https://github.com/odango-chan/ca-skill-studio-demo/pull/10), `main@ac64a048968faa53f438d79e31f3499eec555bbb`. Focused tests and Chromium actual authoring [PASS](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41615104253). This covers A1 only, not full D3.

The first slice is limited to **existing explicit quoted `'on'` maps** on nonterminal Node Operators. It adds exactly one `outcome: existingTarget` line with original line endings, no creation of new `on` maps and no Phase modification. Candidate Outcome labels come only from Outcome names already observed for the same exact Operator value in the current Source (or the same `verify`/`predicate` operator kind). They are editor hints, not Runtime owner permission or a guarantee of real execution. If nothing is qualified, the Inspector remains Source-only for this capability.

Preview integrity is recomputed on Apply; source revision, structural snapshot, Route ID/origin and non-target bytes are checked. Chromium acceptance exercised selection → preview → cancel → apply → Undo/Redo on an actual fixture with one pre-existing Outcome removed.

## D3-A2 candidate implementation (PR #11)

**Review status: Proposed, implemented on the branch only.** [PR #11](https://github.com/odango-chan/ca-skill-studio-demo/pull/11) implements Route-Inspector editing of **one original `operator.on` Outcome**. A source-backed rename is only allowed to an *unused* Outcome already observed for a comparable Operator in the current Source; the target is unchanged. Deletion requires a nonterminal Node with more than one Route, no adjacent or inline comment potentially lost with the line, no detected references to that Route ID, and **no newly unreachable Node** when the single Route is removed. Common core verdicts such as `PASS`, `FAIL`, `UNKNOWN`, `COMMITTED`, `OUTCOME_UNKNOWN`, `DENIED` and `FAILED` are protected from Visual deletion.

Both use exact original YAML span and immutable revision-bound Preview → Source Diff → Confirm → Reparse → Undo/Redo. Quoted keys/values, anchors, aliases, duplicate Outcomes, Phase origin, target drift, ambiguous comments, stale or modified preview fail closed. Browser acceptance covers real Rename and guarded Delete flows; real CreatedSession Child-Procedure qualification is also unit-tested. [CI #41622728664](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41622728664): 208/208 and Chromium PASS on the candidate head.

**Important limitation:** The structural and reachability gates are not proof that a Runtime Operator accepts the renamed Outcome or that a removed branch was genuinely optional. Other runtime-required outcomes may exist beyond the protected list. This UI only provides a conservative edit, with explicit impact warning and human Diff confirmation. For complete contracts, defer to the actual Demo/Runtime owner validator; **Runtime acceptance = NOT_RUN**. D3-A3 and Phase edits remain unimplemented.

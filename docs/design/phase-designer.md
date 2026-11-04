# D4 Phase Designer · Runtime-used Step Authoring

**Status: A1/A2.1/A2.2a/A2.2b1/A3a/A3b1/A3b2a/A3b2b1 Accepted; A3b2b2a impact Accepted (read-only); A4a observed Phase Route retarget candidate; A2.2b2/A3b2b2b/A4b Proposed · Date: 2026-11-04**  
**Implementation: A1/A2.1/A2.2a/A2.2b1/A3a/A3b1/A3b2a/A3b2b1/A3b2b2a merged; A4a PR #37 candidate; A2.2b2/A3b2b2b/A4b NOT_STARTED**  
**Acceptance: A2.2a 245 tests + Chromium PASS; A2.2b1 258 tests + real Chromium PASS; Runtime/5GC NOT_RUN**  
**Tracking: [Issue #15](https://github.com/odango-chan/ca-skill-studio-demo/issues/15)**

## Model and visual hierarchy

Only authored Procedure business Nodes belong to the React Flow main graph. `preconditions` (准备) and `postconditions` (确认) are ordered Step details inside the owner Node Inspector, **not extra business Nodes**. Source YAML and its actual Step indexes, Operator fields, `with` bindings and `on` branches remain the authority. Do not invent another graph model or new Skill syntax.

## Slices

| Slice | Bounded behavior | Must not do |
|---|---|---|
| D4-A1 | Existing Step `with.<key>.from` rebind between **same-Procedure declared `input.*` of the exact same declared `type`** | No new Steps/Bindings, output refs, Step name/operator edit or Phase `on` mutation |
| D4-A2.1 | Switch between two already-observed spellings of the identical earlier named Step output under the same Node | Exact producer, output suffix and ordering fixed; no new refs, cross-Node relinking or field type inference |
| D4-A2.2a | Read-only evidence for input refs, same-Node prior/future Steps, cross-Node graph dominance, script outputSchema title and package schema field declarations | No Source mutation, no producer change, no inference that graph dominance proves output availability or ABI compatibility |
| D4-A2.2b1 | Read-only type-evidence comparison: Procedure input/script output declaration × uniquely resolved local script `inputSchema` field | Type equality is **not** compatibility; consumer refinements, call ABIs, Runtime value existence and cross-producer mutation remain unproven |
| D4-A2.2b2 | Actual cross-producer/field rebind and Step metadata | Requires owner-validated output shape, field/refinement subsumption, consumer ABI, producer availability and versioned Runtime reference semantics; no inferred links |
| D4-A3a | Swap two physically adjacent, unnamed, single-line verify Steps without bindings, comments or output names | No call/script/procedure reordering, named producer, parameter, comment movement, cross-Phase change, new/deleted Step or Runtime ordering claims |
| D4-A3b1 | Append a PredicateSet-declared unnamed/unbound plain Verify to an existing Phase or delete one eligible plain Verify | Never remove the only Step, duplicate a Verify, move comments, delete named/bound producers, create a Phase, or claim runtime equivalence |
| D4-A3b2a | Read-only named Step reference impact + bounded rename with all recognized consumers | Fail closed on unknown occurrences/quoted/duplicate names; no deletion, reorder, guessed alias or Runtime name-equivalence claim |
| D4-A3b2b1 | Give existing plain Verify a unique name, or delete/swap an unreferenced named plain Verify | Zero Source-proven references required; no call/script/procedure effects, named outputs, unsafe comments or Runtime claims |
| D4-A3b2b2a | Read-only delete/reorder verdict for named Steps: output consumers, direct adjacent from edges and effect-contract blockers | No new mutation; do not treat lack of output refs as proof of effect safety |
| D4-A3b2b2b | General Step creation, deletion or reordering with side effects, named outputs or bindings | Needs owner effect semantics and explicit Runtime contract; no graph-node inflation |
| D4-A4a | Retarget existing `preconditions.on` / `postconditions.on` failure/unknown Routes to another already-observed same-Procedure, same-Phase, same-Outcome target | No new Phase/Outcome, no `operator.on`, no `postconditions.on.PASS`, no fabricated target or Runtime claim |
| D4-A4b | Add/rename/delete Phase outcomes or author new Phase Route maps | Needs owner Outcome eligibility and branch completeness semantics; NOT_STARTED |

D4-A1 reads the Procedure's authored `inputs.<key>.type` (string, integer, number, boolean, object, array) to build a **conservative editor-only choice set**. This does not mean that a same-type input is semantically appropriate for a specific Tool/Script/Verify consumer. No Runtime qualification is inferred.

## D4-A1 source patch contract

1. Reparse the **current** YAML 1.2 document and resolve `procedureId / nodeId / phaseName / steps[stepIndex] / with.<key>.from`. AST/CST source coordinates are mandatory.
2. Existing `from` must be a plain scalar `input.<key>` declared by this Procedure, and the alternative must have an equal declared type. Output refs, missing/quoted/aliased/anchored scalars and unknown Phase structures are Source-only.
3. Modify **only the original scalar bytes**, preserving comments, Step order, names, Operators, Route identities, Child Procedures and all unrelated Source.
4. Reproject; compare all Procedure/Node/Step/Child/Route signatures and requalify the changed binding. Display an exact Source Diff to be explicitly confirmed before writing the working copy.
5. Recompute the patch on Apply, validate full Source revision and preview integrity, and record in the standard Undo/Redo history.
6. Only Source editing is available for unsupported/ambiguous references. Error reporting never marks a Runtime action as safe or successful.

## Required acceptance

- Positive: real CreatedSession `nudm-sdm-subscribe.preconditions.steps[0].with.dnn.from`, another declared `string` input, exact source isolation, Diff cancel / Apply / Undo / Redo.
- Negative: mismatched/unknown input, another Procedure's input, invented output paths, absent Phase/Step/binding, quoted or aliased scalar, duplicate YAML keys, stale or forged preview, CRLF and inline comments.
- Browser: expand owning Node's 准备 Step, select qualified input, Diff/cancel/Apply/Undo/Redo and verify main graph's Node count unchanged.
- Gates: unit/negative tests, TypeScript typecheck, build and real Chromium browser interactions. No Runtime/5GC operation or qualification will run.

A2.2b2/A3b2b2b/A4b remain NOT_STARTED; A4a only retargets an existing authored failure Phase Route; A3b2b2a remains read-only, A3a/A3b1/A3b2a/A3b2b1 are bounded editor-tier Step edits, not general effectful deletion/reorder or Runtime qualification.

## A1 actual acceptance

[PR #16](https://github.com/odango-chan/ca-skill-studio-demo/pull/16) contains the bounded Source patch and Inspector editor; [CI #41631114017](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41631114017) verified 229/229 tests, TypeScript, build, and Chromium, including the selected CreatedSession preparation Step, exact Diff, cancel, Apply, Undo/Redo, and Source restoration. Later [CI #41631247083](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41631247083) passed unit/type/build but its Chromium could not start the DevTools debugging port (runner environment); that failure must not be represented as a browser-test assertion PASS. Final A1 [CI #41631580489](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41631580489) passed 230 tests, typecheck, build and real Chromium; [PR #16](https://github.com/odango-chan/ca-skill-studio-demo/pull/16) merged as `a07e441`; [Pages #41631903456](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41631903456) succeeded.

## D4-A2.1: observed same-producer reference spelling (PR #17)

Only an existing Phase Step `with.<key>.from` referencing a uniquely named **earlier Step of the same Node** is eligible. Both `preconditions.<step>.output[.field]` and `<own-node>.preconditions.<step>.output[.field]` (or a correspondingly earlier postcondition) must already appear as plain `from` values in the **same Procedure's YAML Source**. The selected producer Step, Phase, Node, output field suffix and consumer binding key cannot change. Forward references, self-references, cross-Node/Procedure values, renamed/duplicate producers and unobserved aliases fail closed.

UI keeps the Step in its owning Inspector section, never a main graph node. Exact Source span patch → reparse and graph identity check → original YAML Diff → confirmation → Undo/Redo. The real CreatedSession `nudm-sdm-subscribe.preconditions.steps[1].with.selection.from` is the positive specimen; both local and own-node-qualified forms already occur in that root Procedure. These are **observed syntax alternatives, not proved Runtime aliases**. No field type, consumer ABI or 5GC result is inferred. [PR #17](https://github.com/odango-chan/ca-skill-studio-demo/pull/17) [CI #41755713730](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41755713730) verified 238/238 tests, TypeScript, build and real Chromium (selection, exact Diff, cancel, Apply, Undo/Redo, Source restoration). Merge requires this final document-only commit to pass too. All D4-A2.2b cross-producer editing and D4-A3/A4 authoring remain deferred.

## D4-A2.2a · Source-authored dataflow review (PR #18)

The Node Inspector now shows a collapsed **数据依赖** view beside each Phase Step that owns `with.<key>.from` values. From current Source it resolves declared Procedure inputs, earlier/same/future Phase Steps, own Node Operator availability by phase, qualified cross-Node Step/Operator references, ambiguous or absent producer IDs and cross-Node graph-dominator relationships. **Dominator means on every structurally reachable route, not Runtime proof of output existence.** Unknown/future/ambiguous dependencies are explicitly diagnosed instead of silently qualified.

When a same-Package local script declares `# outputSchema: <Name>`, the inspector can match **exactly one** schema by `title` under `schemas/` and report the resolved property `type` where the schema explicitly declares it. Missing/conflicting schema, unresolved `$ref` or unknown fields stay unqualified. Neither these producer declarations nor the available Procedure input types constitute verified consumer Tool/Script input ABI. Every dataflow entry is **read-only** and has a Source line jump; there are no cross-producer edit controls, new graph nodes or YAML writes. The D4-A1/A2.1 write paths remain unchanged.

Real CreatedSession coverage includes `nudm-sdm-subscribe` with the preceding `select-subscription-configuration` script and UDM read provenance from `nudm-sdm-get`. Negatives cover future/self references, duplicate or nonexistent producers, unknown inputs, and absent/conflicting script output schema. [PR #18](https://github.com/odango-chan/ca-skill-studio-demo/pull/18) [CI #41757831884](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41757831884): 245/245 tests, typecheck, build, real Chromium read-only Inspector interaction PASS. Still **Runtime/5GC NOT_RUN**.

## D4-A2.2b1 · Consumer Script Schema Join (PR #19)

Owner snapshot checked: `odango-chan/ca-agent-demo@7d8b22e859d1aaf44e2d2229739f989149155a53` and the Studio's current sample Package. `scripts/select_establishment_configuration.py` declares `# inputSchema: EstablishmentSelectionInput` and `# outputSchema: EstablishmentSelection`, with schemas `schemas/selection-input.schema.yaml` / `schemas/selection.schema.yaml`. The script's `dnn`, `sNssai`, `requestedPduSessionType` and `requestedSscMode` consumer fields are declared directly in the input schema; they can be compared to the existing Procedure `input.*` declared scalar/object types. The consumer schema additionally specifies constraints such as `pattern`, `const`, `required` and nested shapes, so **matching declared types provide evidence only, not an authorization to rebind**.

Implementation `site/phase-consumer-contract.mjs` reads only the current Package file workspace. Script `# /// connectionagent-tool` frontmatter must uniquely identify an `inputSchema`; exactly one schema under `schemas/` must have the matching title; the consumer binding key must be an explicitly declared direct property with one plain `type`. Producer evidence is reused from D4-A2.2a. The Inspector now distinguishes `TYPE_ONLY_MATCH`, `TYPE_MISMATCH`, unavailable producer type, unavailable consumer ABI and unproved schema fields. Even a type-only match is marked **read-only**, with unverified consumer constraints visible. Missing/duplicate schemas, malformed frontmatter, fields with `$ref` or unions, and unknown producer/consumer contracts fail closed.

Current `call` operations such as `sbi.udm.sm_data.get` and `ca.session.pcf_create_inputs.read` do **not** have a complete, package-discoverable versioned output+input ABI binding for this Studio; their fields remain unresolved rather than borrowing a similarly named external JSON Schema. To implement D4-A2.2b2, owner integration must explicitly map each concrete operation identity to versioned consumer input and producer output schemas, define the accepted Phase reference namespace, and validate execution order and source-to-consumer constraint compatibility. The editor must not author guesses.

[PR #19](https://github.com/odango-chan/ca-skill-studio-demo/pull/19) [CI #41769084899](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41769084899) verified 258/258 tests, TypeScript, build and real Chromium. The actual browser checked Script consumer input Schema, `TYPE_ONLY_MATCH`, missing producer and consumer ABI, no write controls, unchanged YAML/Node count. Runtime/5GC qualification remains NOT_RUN. Type evidence does not modify YAML or introduce a second graph state.

## D4-A3a · 受限相邻 Verify Step 换序（已通过编辑器级验收）

第一阶段只处理一个 Node 内同一 Phase 的两个紧邻 Step：二者必须是不同的、未命名、单行纯标量 Verify，不能有 with、name、额外字段、注释、引用或脚本/调用副作用。只交换两行原始 YAML 字节，不反序列化整份源文件；Phase Route、主 Operator、Node、Child、Route 和其他 Procedure 必须重新投影后结构一致。

- qualification：当前 Procedure/Node/Phase/Step index 必须匹配 YAML AST 和投影；两行缩进相同且物理相邻，引用与注释复杂情形一律 Source-only。
- transaction：精确 Source 范围 + 源文本 revision + Diff Preview + 显式确认 + Undo/Redo。Apply 重新计算 Patch 并对所有预览字段抗篡改验证；对候选再次重投影检查只有两条 Step 交换位置。
- 实例：nudm-sdm-subscribe.preconditions 最后两条 ingress.eligible 和 lifecycle.ready；有绑定或命名输出的 Step 不提供移动按钮。
- 这是编辑期结构操作；即使两个 Verify 没有数据依赖，也不证明它们的失败短路语义、观测顺序或 Runtime 效果等价。A3b 的新增、删除和更通用的安全重排需单独建立引用影响判定。

首轮 [CI #41770964460](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41770964460)：264/264 单测、TypeScript、Build、Chromium 均 PASS。浏览器确认只有一个可交换入口、Diff、取消、应用、Undo/Redo、原文恢复。最终文档提交与 Pages 部署仍需单独验证；Runtime/5GC NOT_RUN。

## D4-A3b1 · 受限 Verify Step 新增与删除（PR #30，编辑器级验收通过）

新增只允许在已存在的 Phase.steps 序列末尾插入一个单行、未命名、无 with 的 Verify。必须通过当前 Package 的 PredicateSet（kind、metadata.skill 与声明名均匹配）限定候选，当前 Phase 不得已有同一 Verify。只能采用原 YAML 最后一个纯标量 Step 的原始缩进和换行风格；存在注释/空行、尾部嵌套字段、非安全边界、空 Step 序列或达到 80 Step 上限时拒绝。

删除只允许当前序列中唯一出现、未命名、没有参数绑定和多余字段的单行纯标量 Verify；删除后必须保留至少一个 Step。避免绑定的 Verify、脚本、call、带名字的生产 Step、带注释/引号/alias/anchor 的复杂源段及重复声明，拒绝其可视删除资格。

所有变更只作用于原 Source 的精确完整行插入/删除；随后必须重投影并比较完整 Procedure/Node/Phase/Step/Child/Route 语义签名，差异只能是所选 Step 的出现或消失。Inspector 只展示已证明可编辑的入口，新增控件默认折叠；所有操作必须显示包含业务门禁变化警告的 Source Diff，经确认后才进入历史栈；Apply 重算并检测整个源文件和新增时 PredicateSet 的 revision、预览对象抗篡改，支持 Undo/Redo。

**编辑资格不等于业务或 Runtime 资格**：新增/删除 Verify 会改变流程判定条件、故障短路和执行时序。Studio 不会声称能证明该编辑符合 3GPP 或 Runtime/5GC 的业务要求；真实 E2E 仍为 NOT_RUN。后续 A3b2 才扩展到命名输出、带绑定的 Step 以及引用依赖感知的通用增删改序。

### A3b1 验收证据

[PR #30 CI #41777788675](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41777788675) 验证 272/272 单元测试 PASS、TypeScript PASS、Build PASS 和真实 Chromium PASS；浏览器分别检查新增与删除 Verify 的资格门槛、Diff、取消、应用、Undo/Redo、Source 精确恢复，并证明带绑定的 Step 不显示误删入口。首次单测发现重复 Verify 删除资格的边界遗漏，已补充拒绝规则并复验成功。最终证据不代表 Runtime/5GC E2E。

[PR #30 文档集成验收 CI #41778044582](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41778044582) 亦通过单元测试、类型检查、构建和真实 Chromium；Pages 部署需按合并后的精确主分支结果单独确认。

## D4-A3b2a · 命名 Step 的引用影响与同步改名（PR #32，编辑器级验收通过）

真实 owner 示例 nudm-sdm-subscribe.preconditions.select-subscription-configuration 在同 Node 与后续跨 Node 的 with.*.from 中共被引用 5 次。Studio 在对应 Step 下展示当前 Procedure 来源的引用数量、Consumer Node、原文和 Source 行号。

只有在全源字节级闭集审计可证明每次出现旧 Step 名称都属于：①原始未加引号的单行 name 标量；②与同一生产 Step 对应、未加引号的 local preconditions|postconditions.<step>.output 或 <node>.preconditions|postconditions.<step>.output[.field] 引用，才开放改名。不能忽略注释、另一个 Procedure、未知 namespace、引号、alias、冲突 Step 名、重复生产者；一律禁止可视 Patch 并保留 Source。

改名必须同时替换原 Step 名称和全部已确认 from 引用的精确标量内部字节范围（不 dump 整份 YAML）；Apply 以当前 Source revision 重算完整 Preview，并在修改后重投影所有 Procedure/Node/Phase/Step/Child/Route 结构和重新审计引用个数。Inspector 复用 Diff、显式确认和 Undo/Redo。

本项只提供 editor-tier 的 Source 引用一致性，不证明 Runtime 是否还有额外的跨文件、动态配置或外部消费者，也不保证新的 Step 名称与现有日志、状态或 3GPP 语义等价。命名脚本/调用 Step 的删除和有依赖的排序继续 NOT_STARTED；Runtime/5GC NOT_RUN。

### A3b2a 验收证据

[PR #32 集成 CI #41784309105](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41784309105)：279/279 tests、TypeScript、Build、real Chromium PASS。浏览器选中真实 owner 的命名脚本 Step，确认 Inspector 精确列出 5 个输出消费者，预览 6 处原子修改、取消、应用、Undo/Redo、Source 原文字节恢复；负面测试拒绝引号、注释、未识别引用、重复生产者、冲突名称、过期和篡改 Preview。该 PASS 只涵盖浏览器 Source 编辑，不代表 Runtime/5GC E2E。

## D4-A3b2b1 · 无输出引用的命名 Verify 编辑（PR #34）

当前 owner SKILL 的命名 Step 主要是 script/call，且有潜在副作用。不能仅凭找不到 from 消费者就允许删除或排序这类 Step。本轮仅新增以下受限编辑：①给原先无名无绑定的单行 Verify 写入唯一的 `name`；②删除仅包含两行 `- name` + `verify` 的命名 Verify，前提是当前 Procedure 全源引用审查能够证明输出引用为 0 且不会删空 Phase.steps；③交换此命名 Verify 与物理相邻的另一条纯 Verify（可有名或无名），所有命名 Verify 必须没有任何 Source 输出消费者。

资格检查必须来自当前 YAML AST/CST、原 Source 完整行、源版本和 D4-A3b2a 的唯一生产者/闭集引用审查。任何未知字段、with、Alias、引号、注释、空行、非物理邻接、跨 Phase、不同缩进、重复 Predicate 或 effectful call/script/procedure 都不得误开 Visual 结构修改。全部 Source patch 重新投影完整 Procedure/Node/Phase/Step/Child/Route 签名，只有明确的目标 Step 身份、删除或顺序可以变化；复用 Diff / 明确确认 / Undo/Redo、过期或伪造预览拒绝。

默认样例中可先在 `nudm-sdm-subscribe.preconditions` 的 `createdsession.ingress.eligible` 上使用「命名 Verify」，之后可按上述限制与相邻 `createdsession.lifecycle.ready` 调换位置或删除。此项用于测试 Studio 编辑能力，不代表应对真实 5GC 流程删除或重排这些业务检查。

**安全边界**：无输出引用仅能说明当前 Procedure 内没有被识别的 Source 消费者，不足以判断运行时副作用、故障短路、审计或业务正确性。工具/脚本 Step、带绑定及引用的 Step 删除/换序继续保持只读；Runtime/5GC E2E NOT_RUN。

### D4-A3b2b1 验收证据

[PR #34 集成 CI #41786616595](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41786616595)：289/289 单元测试、TypeScript、Build、真实 Chromium 全部 PASS。浏览器在 `nudm-sdm-subscribe.preconditions` 中完成「命名 Verify → 相邻换序 → 删除」的 Source Diff、取消、应用、Undo/Redo 与原 YAML 完整恢复；命名脚本/工具调用没有获得删除或换序入口。最终文档提交与 Pages 部署还需另外验证；Runtime/5GC E2E NOT_RUN。

## D4-A3b2b2a · 命名 Step 删除/换序影响门禁（PR #36，编辑器级验收通过）

第一阶段明确 **只读审查**。对一个命名 Phase Step，结合现有当前 Procedure AST/Source 的生产者唯一性、命名输出消费者、同 Node Phase `with.*.from` 依赖，以及 D4-A2.2a 的依赖路径报告，单独形成删除与「同 Phase 与下一条 Step 换序」的证据状态。

判定区分 OUTPUT_CONSUMERS（有下游引用）、DIRECT_DATA_DEPENDENCY（相邻后一步明确消费前一步的输出）、UNKNOWN_REFERENCES（名称/引用无法闭集核验）、EFFECT_UNPROVEN（script/call/procedure 真实副作用和先后顺序没有 owner 契约）、UNRESOLVED_INPUTS、NO_NEXT_STEP，以及 VERIFY_EDITOR_RULES（仅为已有纯 Verify 专用 Source 编辑器候选，绝不是此模块授予的新写权限）。即使不存在任何 `from` 引用，也不能据此给 Call/Script 开放删除或重排。

当前真实样例 `nudm-sdm-subscribe.preconditions` 中：`select-subscription-configuration` 的输出通过 `with.selection.from` 被紧邻的 `resolve-pcf-create-inputs` 消费；后者的输出又被紧邻 Verify 的两个输入消费。Inspector 在既有折叠「引用影响」下显示对应依赖的 Source 行号、键、原值及禁止原因，保持现有图、Source 和编辑按钮不变。

负面场景：移除显式相邻 from 依赖后仍因 effect 语义未证明而禁止 script/call 调序；带输出消费者的 Verify 不得错误地通过仅凭 operator 的检查；引号/未知引用 fail closed；独立且命名的纯 Verify 仅返回 VERIFY_EDITOR_RULES，实际编辑仍走 A3b2b1 的 AST 精确资格、Diff、确认、Undo/Redo。此处不会执行真实脚本、Tool 或 5GC；Runtime/5GC E2E NOT_RUN。

### D4-A3b2b2a 验收证据

[PR #36 代码与文档 CI #41788514319](https://github.com/odango-chan/ca-skill-studio-demo/actions/runs/41788514319)：298/298 单元测试、TypeScript、Build、真实 Chromium PASS。实际浏览器确认 Script → Call 与 Call → Verify 的直接输出依赖各在已有 Inspector 里显示 Source 行号、阻止原因；没有新写入口；原有命名 Step 的 5 条消费引用列表及 Diff/确认/Undo/Redo 回归 PASS。第一次 CI 在浏览器中发现新增影响行复用 consumer 类导致计数回归，修复为独立 UI 类后同一完整浏览器套件通过。Runtime/5GC E2E NOT_RUN。

## D4-A4a · 已存在 Phase Route 的失败/未知目标重定向（PR #37）

本阶段只提供一项小而有用的 Source 编辑：在 **已有** `preconditions.on` 里改 `FAILED` 或 `UNRESOLVED` 的目标；在 **已有** `postconditions.on` 里改 `FAIL` 或 `UNKNOWN` 的目标。候选必须是 **同一个 Procedure 内另一个 Node 的同一 Phase 与同一 Outcome** 当前 Source 已观察的目标 Node，不能从其他 Phase、operator.on、PASS 或外部 Tool 推断，也不能凭空创建 Phase、Outcome 或目标。

资格来自 YAML 1.2 AST/CST，要求原 Phase 的显式 `'on'` 字符串键、单行普通 Outcome 和 Target、结构清晰无混入注释或空行且 Route.sourceSpan 与该值严格一致。仅替换 **当前目标标量**，重投影全 Procedure/Node/Phase/Child/Route 身份；只有该 Route 的 `target` 允许改变，且该 Procedure 的可达 Node 集合不变。原始 YAML 仍是唯一真源；Inspector「准备 / 确认」内折叠下拉选择 → Diff 预览 → 明确确认 → 同一 History Undo/Redo；整份 Source 修订与 Preview 抗篡改核对。

真实 owner 示例：`nudm-sdm-subscribe.preconditions.FAILED: failed` 可改为同 Procedure 其他准备阶段的 `FAILED: finalize-failed` 目标；但这会把失败流向不同的收尾/资源清理路径。后置条件的 `FAIL` 也使用相同规则；主 Operator.on 和 `postconditions.on.PASS` 都不在写权限范围。此操作不声明这两个目标在业务上等价，也不表示任何 3GPP/Runtime 资格通过。

注意：候选来自**当前 Source 已观察值**。改完后若旧目标已不再由任何其他同 Phase/Outcome 使用，下拉框不会发明一个「回退目标」；要还原原文，应通过现有 Undo，或手工 Source 编辑。允许选择、原始缩进/换行保留和完整结构签名均由测试验证。

负面场景：跨 Phase 引用、主 operator.on、PASS、缺失/猜测目标、重复 key、引号/anchor/alias、注释归属不清、跨行与混用行尾、过期或篡改的 Diff Preview 均拒绝；结构变更会使原来可达 Node 消失时也拒绝。A4b Phase Outcome 新增/重命名/删除及完整 Runtime branch completeness 校验继续 NOT_STARTED；Runtime/5GC E2E NOT_RUN。

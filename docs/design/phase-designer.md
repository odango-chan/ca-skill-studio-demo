# D4 Phase Designer · Runtime-used Step Authoring

**Status: A1/A2.1/A2.2a/A2.2b1 Accepted; A3a bounded Verify swap Accepted; A3b1 bounded Verify add/delete candidate; A2.2b2/A3b2/A4 Proposed · Date: 2026-11-04**  
**Implementation: A1/A2.1/A2.2a/A2.2b1/A3a merged; A3b1 in PR #30 candidate; A2.2b2/A3b2/A4 NOT_STARTED**  
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
| D4-A3b2 | General Step creation, removal or reordering with named outputs and bindings | Requires dependency impact analysis for named Steps and all output references, no graph-node inflation |
| D4-A4 | Phase-specific `on` Route authoring | Must separate `preconditions.on` / `postconditions.on` from `operator.on` and use owner Outcome eligibility |

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

A2.2b2/A3b2/A4 remain NOT_STARTED; A3a and A3b1 are strictly bounded editor-tier Verify edits, not generalized Step authoring or Runtime qualification.

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

## D4-A3b1 · 受限 Verify Step 新增与删除（PR #30）

新增只允许在已存在的 Phase.steps 序列末尾插入一个单行、未命名、无 with 的 Verify。必须通过当前 Package 的 PredicateSet（kind、metadata.skill 与声明名均匹配）限定候选，当前 Phase 不得已有同一 Verify。只能采用原 YAML 最后一个纯标量 Step 的原始缩进和换行风格；存在注释/空行、尾部嵌套字段、非安全边界、空 Step 序列或达到 80 Step 上限时拒绝。

删除只允许当前序列中唯一出现、未命名、没有参数绑定和多余字段的单行纯标量 Verify；删除后必须保留至少一个 Step。避免绑定的 Verify、脚本、call、带名字的生产 Step、带注释/引号/alias/anchor 的复杂源段及重复声明，拒绝其可视删除资格。

所有变更只作用于原 Source 的精确完整行插入/删除；随后必须重投影并比较完整 Procedure/Node/Phase/Step/Child/Route 语义签名，差异只能是所选 Step 的出现或消失。Inspector 只展示已证明可编辑的入口，新增控件默认折叠；所有操作必须显示包含业务门禁变化警告的 Source Diff，经确认后才进入历史栈；Apply 重算并检测整个源文件和新增时 PredicateSet 的 revision、预览对象抗篡改，支持 Undo/Redo。

**编辑资格不等于业务或 Runtime 资格**：新增/删除 Verify 会改变流程判定条件、故障短路和执行时序。Studio 不会声称能证明该编辑符合 3GPP 或 Runtime/5GC 的业务要求；真实 E2E 仍为 NOT_RUN。后续 A3b2 才扩展到命名输出、带绑定的 Step 以及引用依赖感知的通用增删改序。

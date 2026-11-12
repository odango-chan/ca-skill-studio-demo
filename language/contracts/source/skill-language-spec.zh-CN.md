# ConnectionAgent Skill 语言规范

**版本：** v0.2  
**状态：** 当前目标无状态 Compiler 的源码语言契约；Compiler 一致性验收单独记录。  
**归属：** `ca-skills`  
**消费者：** `ca-skill-compiler`、Skill Studio 和未来 LSP。

本仓库拥有官方 Skill 语言与官方 Skill 源码。Compiler 实现这套语言，不另造 DSL、导入格式或包管理系统。

## 1. 权威与边界

`ca-skills` 是 Skill 源码语言契约和官方 Skill 包的唯一权威。当前 `ca-agent-demo` 源码用于核对实际运行行为、刷新样例，不是第二个 Skill 输入源。

- 本规范定义源码构造、支持语法、身份与引用位置。
- [Script 契约](script-contract.md)定义唯一的 Skill 自有 Python Script 形式。
- [Schema 所有权](schema-ownership.md)定义每类 Schema 的真正生产者。
- [Authoring Model](authoring-model.md)定义 Procedure 业务语义。
- [语义 Token 投影](../language/semantic-tokens.v1.json)定义编辑器 Token 分类，不定义语法，也不代表引用已经链接成功。
- 目标 Compiler 对调用方提供的文件字节进行解析、链接、校验和生成。Studio/调用方负责获取依赖并组装 BuildRequest；Compiler 不获取、持久化、锁定、刷新或管理依赖。
- 声明或链接成功不代表 Tool 已实现、有权限、Runtime READY、执行成功、Case 通过或真实 5GC 验收。

旧版 `ca-skill-toolchain` Schema 不是语言权威。Compiler 必须实现本契约，不能为了满足旧 Schema 而扁平化或静默忽略源码语义。

## 2. 语言 Artifact

| 层次 | 源文件 | 职责 |
| --- | --- | --- |
| 模型指导 | `SKILL.md` | 标准 Skill frontmatter 和面向模型的业务指导 |
| Skill 契约 | `assurance/contract.yaml` | Skill 身份、目标、入口 Procedure、Request/Context Schema 引用、资源授权与最终条件 |
| Procedure | `assurance/procedure.yaml` | 确定性流程图、Operation 调用、Script/Procedure/Predicate 引用、绑定和路由 |
| Predicate 集合 | `assurance/predicates.yaml` | Observation 声明，以及基于已物化 Evidence 的 CEL 或 Script 判断 |
| Case | `cases/*/case.yaml` | 源码级场景和语义义务；不是执行器或 Qualification 引擎 |
| Script | `scripts/*.py` | Skill 自有的确定性本地计算，使用严格 Output `TypedDict` |
| Skill 自有 Schema | `schemas/**` | 公共 Request 和其他真正由 Skill 拥有的接口 |
| Reference | `references/**/*.md` | 可选模型知识，不是可执行语法或 Evidence |
| 导入契约 | Compiler 逻辑输入 `lib/**` | Studio/调用方提供的 Tool/Host/Observation Owner 契约 |

Script 输出 Schema 是 BuildResult 生成产物，不是 `schemas/` 下的作者源码，也不能再次作为 Compiler 输入。

## 3. SkillContract

文档身份仍为 `apiVersion: connectionagent.io/v1alpha1` / `kind: SkillContract`。关键字段：

- `spec.inputs.requestSchema`：Skill 自己拥有的公共 Request Schema。
- `spec.context.requiredFacts`：必需事实标识符列表，**不是**字段级 Schema。
- `spec.context.schemas`：当使用 `subject`、`facts`、`observations`、`evidence` 命名空间时，显式引用对应 Owner Schema。
- `spec.allowedResources.capabilities[]`：资源授权上界。值可以是部署 Capability ID 或直接 Operation ID；它不是 Script 白名单。
- Contract 级 preconditions/postconditions 是 Skill 全局条件，与 Procedure 节点级条件不同。
- 不再有 `allowedResources.localTools`。Script 是 Skill 内部源码资产，不是独立可调用 Tool。

外部 Schema 引用示例：

~~~yaml
spec:
  inputs:
    requestSchema: schemas/establishment-request.schema.yaml
  context:
    requiredFacts:
      - createdsession_ingress
    schemas:
      subject: lib/host/subject.schema.yaml
      facts: lib/host/facts.schema.yaml
      observations: lib/observations/context-observations.schema.yaml
      evidence: lib/host/evidence.schema.yaml
~~~

所有路径均相对于逻辑 BuildRequest 文件集合。使用到对应命名空间但路径缺失或没有权威 Owner Schema 时，必须报错。不能用 `requiredFacts` 名称、宽泛 object 或部署配置 Schema 替代。

## 4. Procedure

当前源码采用命名 Procedure 与命名 Node 的 Map：

~~~yaml
procedures:
  establish:
    inputs:
      dnn:
        type: string
        from: context.request.dnn
    start: read-subscription
    nodes:
      read-subscription:
        call: sbi.udm.sm_data.get
        with:
          dnn:
            from: input.dnn
        'on':
          SUCCEEDED: verify-subscription
          FAILED: failed
      verify-subscription:
        verify: example.subscription_usable
        'on':
          PASS: done
          FAIL: failed
          UNKNOWN: unresolved
      done:
        terminal: SUCCEEDED
~~~

当前支持的主节点意图只有：

| 意图 | 含义 |
| --- | --- |
| `call` | 调用一个精确的导入 Tool Operation |
| `script` | 按 Skill 包相对路径运行自有 Script |
| `procedure` | 调用本地 Procedure 或显式指定的跨 Skill Procedure |
| `verify` | 判断 Predicate |
| `reconcile` | 调和原始 Mutation Node |
| `terminal` | 以声明的 Procedure 终态结束 |

`call` 始终是**标量 Operation ID**，例如：

~~~yaml
call: sbi.udm.sm_data.get
~~~

它不是 Capability 分组、Dependency 名称、MCP Tool 名称、对象或 `{dependency, operation}`。Studio/调用方把所需 ToolCatalog 文件装配到逻辑 `lib/**` 输入中；Compiler 根据精确 Operation ID 跨已提供的 ToolCatalog 链接。Operation ID 在本次输入集合中必须唯一，缺失或重复均报错。Skill 源码没有 Dependency 命名空间或别名。

`Procedure.inputs.<name>.from` 与 `with.<argument>.from` 是显式数据绑定。`with` 每项只能有 `from` 或 `value`。`Procedure.inputs.<name>.type` 只能作为作者类型断言，由真实 Producer Schema 校验；不能用它创建或替代缺失的 Schema。

主节点 `procedure` 可引用本地 Procedure 名称，也可用显式 `{skill, procedure}` 指定跨 Skill Procedure。不存在隐式前序节点绑定、字符串插值、动态 selector 或自动 Skill 路由。

### 4.1 节点级 Preconditions / Postconditions

`preconditions` 和 `postconditions` 是有序的节点进入/结果阶段，使用 `steps` 和显式 `'on'` 路由。当前只支持 `call`、`script`、`verify` 三种步骤意图。每个命名 Step 有独立作用域；引用使用精确生产者路径，例如 `preconditions.<step>.output` 或 `<node>.preconditions.<step>.output`。

影响执行语义的未知字段和不支持的动作必须明确失败。`tool`、`for` 和 `applicability.when` 不属于当前语言版本，不能把旧编写笔记当作允许 Compiler 接受它们的依据。

## 5. PredicateSet

`assurance/predicates.yaml` 声明 Predicate 身份和必需 Observation。Evaluator 只能是：

- `{type: cel, expression: ...}`：基于已物化 Evidence 的 CEL 表达式；或
- `{type: script, ref: scripts/foo.py}`：Skill 自有 Predicate Script。

`evaluator.ref` 是包内相对 Script 路径，不是 `skill.*` Tool ID。Predicate Script 输入采用 [Script 契约](script-contract.md)定义的 Predicate Evaluation Context，不负责获取 Observation 或调用 Provider。

## 6. Cases

每个 Case 是一个 `cases/<name>/case.yaml` 源码级场景和预期语义义务。Compiler 不执行 Case，也不实现 Qualification、Case Runner、Release Gate 或 Runtime readiness。

## 7. ToolCatalog、Capability 与 Operation 身份

当前正式导入的 ToolCatalog 为 `lib/tools/createdsession.tool.yaml`。它在 `spec.contracts[].operation` 中定义精确 Operation，并附带 Effect 与 Input/Output/Reconcile Schema。

必须区分：

- Capability ID：部署侧拥有的资源分组/授权身份。
- Operation ID：ToolCatalog 声明的一个精确可调用操作。
- Procedure `call`：始终是 Operation ID。
- `allowedResources.capabilities[]`：Skill 声明的资源授权上界；当前传统 PDU 条目是直接 Operation ID。

ToolCatalog 快照只证明契约文件已提供，不证明 Adapter 已注册、已授权、已就绪或执行成功。MAS Skill 的 16 个 `ca.pdu_session.*` Operation 引用仍未解析，因为没有正式批准的 MAS ToolCatalog；设计稿不能作为正式 Library。

## 8. Schema 所有权

详见 [Schema Ownership](schema-ownership.md)。简要规则：Skill 拥有公共 Request Schema；Tool/Host/Observation Owner 拥有 Producer Schema；Procedure 绑定派生 Script 输入投影；Script `TypedDict` 声明自身计算输出；Compiler 生成 Script Output Schema。

## 9. 编辑器与 Compiler 消费者

机器可读 Token 注册表是 [`language/semantic-tokens.v1.json`](../language/semantic-tokens.v1.json)。它只分类源码位置，颜色不代表链接成功。

Studio/调用方组装 `files` 和可选 targets。Compiler 接收字节，返回诊断和生成文件，不做依赖获取或包管理。Native Go 与 WASM 必须实现相同语言语义。Compiler Build 成功不代表 Script 执行、Runtime READY、Qualification 或真实 5GC 成功。

## 10. 变更控制

语言变更必须同步更新本规范、对应专项契约、正负例源码 Fixture、语义 Token 投影和中英文编写指南。除非业务 Owner 明确改变决定，否则保留当前业务 Procedure 语义。Compiler 跟随语言实现，不得静默重新定义语言。

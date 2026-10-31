# 系统架构

**状态：Proposed · Authoring-first · 技术栈未锁定**

## 1. 总体结构

~~~text
Skill Studio Workbench
  ├── Workspace / Package Explorer
  ├── Markdown / Source Editors
  ├── Procedure Designer (Visual / Source / Split)
  ├── Semantic Inspector
  └── Problems / Inline Diagnostics
          |
          v
Authoring Application Services
  ├── Package Discovery / File Watch
  ├── Source Buffer / Revision Manager
  ├── Round-trip AST / CST
  ├── Compatibility Parser / Semantic Extractor
  ├── Source Map / Cross-reference Index
  ├── Typed Patch Engine
  ├── Diff / Undo / Redo / Conflict Resolver
  └── Save Adapter (local working copy)
          |
          v
Demo Compatibility Adapters
  ├── YAML Semantic Loader Adapter
  ├── Local Schema Snapshot Adapter
  └── CreatedSession Transitional Validator Adapter
          |
          v
ca-agent-demo (read-only reference baseline)
~~~

## 2. 模块职责

### Workbench UI

负责 Runtime Asset Explorer、多文件 Tab、Source / Visual / Split、Procedure Canvas、Inspector 和 Problems。UI 只把有模型上下文加载或 Host / Runtime 消费证据的资产作为一等编辑对象；UI 不拥有独立 Skill 语义权威。

### Workspace / Package Service

管理用户明确打开的 Workspace、完整 Package 文件集合、Runtime Asset Map、文件监视、打开状态、Working Buffer、完整 Artifact Digest 和本地 Save。未展示为一等编辑资产的文件仍需原样保留。首版不自动 commit / push。

### Round-trip Source Layer

维护 Concrete Syntax / Round-trip Tree，负责源位置、注释、顺序、标量样式、未知字段和局部 Patch。普通 YAML SafeLoader 不能替代该层。

### Compatibility Parser / Semantic Extractor

在保留 CST 的基础上解析出 Procedure / Node / Operator / Phase / Route / Binding 等类型化语义。Parser 必须带 Compatibility Profile 和来源版本。

### Typed Patch Engine

将 Visual / Inspector 编辑操作转成 Typed Source Patch；检查目标 revision、语义前置条件和编辑资格；在临时 Tree 中应用并序列化局部区域；重新解析并验证结果；失败时原子回滚。

### Semantic Index

维护 Node、Predicate、Capability、Contract、Binding Producer / Consumer 和跨文件引用关系。索引可重建，不得成为权威源。

### Problems

呈现 Parse、Dangling Reference、Unsupported Syntax、Conflict 和轻量静态诊断。它是编辑辅助面板，不是独立 Validation Center。

### Compatibility Adapter

以固定 Demo baseline 为依据解释语法和运行已有静态校验器。必须报告 Demo Commit、Schema Snapshot Digest、Validator 路径 / 版本和原始诊断。它不拥有 Runtime authority。

## 3. 核心数据流

### 打开 Package

~~~text
Workspace path / imported sample package
  -> discover actual files
  -> load Source buffers
  -> build Round-trip Trees
  -> parse with Compatibility Profile
  -> build Semantic Model + Source Map
  -> build cross-reference index
  -> render Source / Visual / Inspector
~~~

### Source 编辑

~~~text
User edits source buffer
  -> incremental parse
  -> update affected semantic objects
  -> update graph / inspector / references
  -> if parse fails: keep source, mark projection STALE
~~~

### Visual 编辑

~~~text
User visual command
  -> resolve semantic target
  -> create Typed Source Patch
  -> check revision / capability / preconditions
  -> apply to temporary Round-trip Tree
  -> serialize touched region
  -> reparse + compare intended semantics
  -> show Diff
  -> apply to working buffer
  -> user Save
~~~

## 4. 单一权威源

Skill Package 文件是唯一源。Semantic Model、Graph、Inspector State、Reference Index 和 Problems 都是派生数据。

画布坐标、折叠、选择、缩放和布局属于 UI state，不得静默写入 Skill YAML。若未来需要持久化布局，使用独立 Studio metadata，并明确它不是 Skill Runtime 输入。

## 5. YAML 兼容性

Demo 当前 Loader 通过 PyYAML SafeLoader 调整 bool resolver，使 true / false 保持布尔值，而未加引号的 on 仍作为字符串键。

Studio 的 Round-trip Parser 与 Demo Validator Adapter 必须对这一行为达成一致。Round-trip Parser 还必须保留注释、顺序和 scalar style。不能把 Demo Loader 本身当成无损编辑器。

如果 Round-trip POC 无法证明局部修改无损，则对应区域只允许 Source 编辑或 Preserve-only，不开放 Visual Patch。

## 6. 版本、冲突和事务

每个 Document 绑定 Base Revision、Working Revision、External Revision。每个 Typed Patch 绑定生成时的 Source Revision 和目标结构指纹。

跨文件重命名、删除和引用更新必须作为可审查的多文件事务；在原子写入能力未实现前，先显示影响清单，不自动批量修改。

## 7. 安全边界

- 文件访问限制在用户明确选择的 Workspace 根目录；
- 禁止路径穿越和未经授权的符号链接逃逸；
- Preview、Parse 和 Problems 不执行 Script；
- 静态诊断不调用 Capability；
- AI 只能提出候选 Patch；
- Save 只写本地工作副本；
- 外部副作用、Runtime、Live 5GC 和发布操作不属于当前架构范围。

## 8. 技术决策状态

当前没有应用脚手架，也不锁定 React / Vue / Svelte、Monaco / CodeMirror、Graph Library、Tauri / Electron 或纯 Web。

先完成 Round-trip YAML POC 和 Typed Patch 最小模型，再根据编辑器部署目标选择 UI / Graph 技术。具体 POC 顺序见 [Source-preserving Edit Model](source-preserving-edit-model.md)。

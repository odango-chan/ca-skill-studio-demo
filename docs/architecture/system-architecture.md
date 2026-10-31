# 系统架构

**状态：Proposed · 仅定义边界，不锁定技术栈**

## 1. 总体结构

~~~text
Skill Studio UI
  ├── Workspace / Package Explorer
  ├── Markdown & Source Editors
  ├── Procedure Graph Projection
  ├── Asset Inspectors
  └── Validation Center
          |
          v
Workspace Application Services
  ├── Package Discovery
  ├── Source / Round-trip AST
  ├── Cross-reference Index
  ├── Diagnostics Model
  ├── Diff / Undo / Redo
  └── Source Digest
          |
          v
Demo Compatibility Adapters
  ├── YAML / Package Parser Adapter
  ├── Local Schema Snapshot Adapter
  ├── CreatedSession Transitional Validator Adapter
  └── make verify / pytest Adapter
          |
          v
ca-agent-demo (read-only reference baseline)
~~~

## 2. 模块职责

### UI

负责交互、布局、画布、Source 编辑、Inspector 和诊断呈现。不包含独立的 Skill 语义权威。

### Workspace Service

管理用户打开的 Package、文件状态、AST、引用索引、Diff、Undo / Redo 和 Digest。

### Parser / Round-trip AST

解析 Markdown、YAML、JSON 和 CEL 文本。YAML 编辑层必须支持注释、顺序、标量风格和源位置保留。Demo validator 可继续使用自己的 PyYAML Loader 作为校验适配器，但不应将其当作无损编辑器。

### Compatibility Adapter

以固定 Demo baseline 为依据调用现有解析和校验行为。Adapter 应报告使用的 Demo Commit、Schema snapshot 路径和 Digest、Validator 路径和版本、检查范围、原始诊断和退出码。

### Qualification Adapter

第一阶段只呈现当前本地门禁和可用的 Case 定义。真实 Runtime、Live 5GC 或远程执行集成不属于当前阶段。

## 3. 数据流

### 打开 Package

~~~text
Workspace path / imported fixture
  -> discover package files
  -> parse source files
  -> build typed document model
  -> build cross-reference index
  -> derive visual projections
  -> render editors
~~~

### 修改源文件

~~~text
User edit
  -> source patch
  -> round-trip serialization
  -> update document model
  -> refresh graph / references
  -> mark affected diagnostics stale
  -> persist draft
~~~

### 图形编辑（后续阶段）

~~~text
Graph interaction
  -> typed semantic patch
  -> validate patch preconditions
  -> apply to source AST
  -> round-trip serialize
  -> reparse and compare
  -> show diff
  -> user save
~~~

## 4. 单一权威源

Skill Package 文件是唯一源。Graph JSON、Inspector State、Reference Index 和 Validation Report 都是派生数据或带版本的记录。

任何派生数据都必须能够由源文件和固定工具版本重新生成。

## 5. 解析与无损编辑

Demo 当前的 YAML Loader 通过 PyYAML SafeLoader 调整 bool resolver，使 true / false 保持布尔值，而未加引号的 on 仍作为字符串键。这是兼容性要求。

该 Loader 本身不提供完整的注释 round-trip 编辑能力。Studio 需要独立选择支持 round-trip 的 AST / CST 方案，并用 Demo validator 对保存后的结果重新验证。

如果无法无损处理未知语法，则 Source-only / Read-only 优先于有损保存。

## 6. 版本与缓存

建议所有缓存键和验证结果绑定 Source Package Digest、Baseline Commit、Schema Snapshot Digest、Adapter Version、Fixture Digest 和 Execution Environment。

缓存只用于加速，不能成为验证权威。

## 7. 安全模型

- Workspace 文件访问限制在用户选择的根目录；
- 禁止路径穿越和未经授权的符号链接逃逸；
- Preview 不执行 Script；
- 静态 Validate 不调用 Capability；
- Script Sandbox 是单独能力；
- 外部副作用操作需显式授权；
- AI Patch 经过 Diff 和人工确认。

## 8. 技术栈决策

当前不锁定 React / Vue、Graph Library、Monaco / CodeMirror、Tauri / Electron 或纯 Web。

技术选型前应完成 Round-trip YAML POC、Procedure graph 可访问性和大图性能 POC、本地文件 Workspace 安全模型、Demo validator Adapter 可执行性验证，以及 Windows / WSL 开发体验评估。

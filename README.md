# ConnectionAgent Skill Studio Demo

面向 ConnectionAgent Skill 开发与编辑的独立 Demo 仓库。

## 在线 Source 编辑预览

GitHub Pages 计划发布到：

https://odango-chan.github.io/ca-skill-studio-demo/

当前 site/ 是**无需后端、无需构建工具**的浏览器端 Source 编辑预览，支持：

- 打开单个本地 Markdown / YAML / JSON / Script 文本文件（≤ 1 MiB）。
- 在浏览器内存中编辑，查看简单文本大纲。
- 下载修改后的文件；Ctrl/Cmd+S 触发导出。
- 不上传源文件、不执行 Skill、Script 或 Capability。

**重要限制：** 此在线原型尚未实现 Visual Graph、跨文件 Workspace、Typed Source Patch、Diff、无损 round-trip 保证、可靠原子保存、Demo Validator 或 Runtime 验收。页面上的简单大纲**不是** Procedure 语义投影。导出下载也不是对原工作区文件的原地保存。

## GitHub Pages 自动部署

工作流：.github/workflows/pages.yml。支持 main 分支 site/** 修改后的自动部署，以及在 Actions 页面手动运行（workflow_dispatch）。

GitHub 仓库设置需要在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**；之后在 **Actions → Deploy Skill Studio Pages → Run workflow** 可手动部署 main。如果 Pages 尚未开启，工作流可能因目标站点未配置而失败；不能将工作流文件已提交视为网站已上线。

部署制品只包含 site/ 内的公开前端文件。不要把私密数据、真实账号凭据或敏感 Skill 资产提交至 site/。

## 设计与 POC 分支

- [PR #1 · 设计与 UX 文档](https://github.com/odango-chan/ca-skill-studio-demo/pull/1)：尚未合并 main。
- [PR #2 · Python source-preserving Typed Patch POC](https://github.com/odango-chan/ca-skill-studio-demo/pull/2)：尚未合并 main；代码不在此 Pages 静态站点内运行。
- [兼容性参考 ca-agent-demo](https://github.com/odango-chan/ca-agent-demo)：只读。

当前产品范围聚焦 SKILL.md、Contract / Procedure / Predicate、受治理 Script 与实际被 Host 消费的 Reference；Case、独立验证中心、发布/安装工作台暂不实现。

**下一步：** 以实际 Procedure 资产和 Compatibility Profile 为依据，设计 React/TypeScript 的 Visual/Split 界面及大型图形导航；结构化修改必须先具备可审查的 source-preserving Patch 能力，不能用图形修改绕过现有 POC 的限制。

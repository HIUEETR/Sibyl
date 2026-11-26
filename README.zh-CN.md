[English](./README.md) | 简体中文

# Sibyl

**Sibyl** 是一个通用、不绑定单一厂商的 **Skill + Rule + Hook + 单文件 CLI / MCP** 防误删安全垃圾桶系统，面向 Antigravity、Claude Code 及通用 Agent Harness 设计。它通过将高危永久删除替换为可恢复的垃圾桶移动、拦截复合命令与内联脚本绕过、保护自身配置与垃圾桶不被篡改，并提供面向无人值守长任务的自治配额清理机制，避免代理在执行过程中意外丢失本地文件或未提交代码。

## 设计背景与纵深防护

当前 Agent Harness 通常在本地电脑拥有较高的文件系统与 Shell 权限。一次误判的 `rm -rf`、通配符失误、内联脚本删除或破坏性 `git reset --hard`，都可能导致数据永久损失。Sibyl 采用四层协同架构，同时兼顾长任务无人值守运行不被弹窗阻塞：

1. **引导层（Rule + `SessionStart` + `SKILL.md`）**：在会话启动时注入简洁安全规则，并通过技能文档指导模型优先使用 `trash`、`status`、`list`、`restore` 与 `purge`。
2. **拦截层（`PreToolUse` Hook）**：采用无人值守友好的确定性策略。简单明确的单一删除命令（`rm`、`rmdir`、`unlink`、`del`、`erase`、`rd`、`Remove-Item`、`ri`）会自动改写为 `sibyl trash`；复杂复合命令、通配符或变量删除、`find -delete`、`xargs rm`、内联脚本删除（`python -c`、`node -e`、`pwsh -Command` 等）、破坏性 Git 操作以及自保护越权操作，统一返回附带可执行替代方案的 `deny`，让模型自行纠偏而无需人工介入挂起。
3. **隔离存储层（垃圾桶引擎）**：默认采用工作区就近隔离策略，工作区内目标移入 `<workspace>/.sibyl-trash`（首次创建时自动在内部写入内容为 `*` 的 `.gitignore`，不污染项目根 `.gitignore`），工作区外路径回退到 `~/.sibyl/trash`（支持通过 `SIBYL_HOME` 覆盖）。
4. **自治安全清理层（`purge`）**：受代码级三重护栏约束——仅当总占用超过 `maxBytes`（默认 `1 GiB`）时解锁，严格跳过冷静期（默认 `24` 小时）内的新增条目，并按先进先出（FIFO）顺序永久清理最老的过期条目，直至总占用回落至安全水位线（默认 `50%`，即 `512 MiB`）。

## 核心特性

- **无人值守优先**：默认不触发交互式 `force_ask` / `ask` 审核弹窗，确保长时间自动化任务流畅推进。
- **软链接与跨盘安全**：全程使用 `lstat` 识别符号链接与 Windows 目录联接，只移走链接本身，绝不穿透破坏原目标内容；跨盘出现 `EXDEV` 时自动回退为保留软链接的递归复制、完整性校验与源路径清理。
- **防篡改自保护**：同时拦截 Shell 命令与文件写/改工具（`write_file`、`edit_file`、`Write`、`Edit`、`MultiEdit`），禁止模型修改或删除 `.sibyl-trash`、`.sibyl.json`、`hooks.json`、`.claude/settings.json` 与 `sibyl.mjs`。
- **单文件零运行时依赖**：CLI、Hook 适配器、`init` 安装器与 stdio MCP Server 全部打包为 `skills/sibyl/scripts/sibyl.mjs`（支持 Node >= 18）。

## 快速开始

安装开发依赖并构建单文件产物：

```bash
pnpm install
pnpm run build
```

在任意目标项目根目录一键初始化 Sibyl（支持 `antigravity`、`claude` 或 `all`）：

```bash
node skills/sibyl/scripts/sibyl.mjs init --target all --scope workspace --with-mcp
```

`init` 常用可选参数：
- `--scope global`：安装到用户全局目录（`~/.gemini/config/` 与 `~/.claude/`）。
- `--update-gitignore`：额外将 `.sibyl-trash/` 追加到项目根 `.gitignore`。
- `--with-mcp`：输出可直接填入配置的 stdio MCP Server 片段。

## CLI 命令参考

```bash
sibyl trash [--cwd <dir>] [--reason <text>] [--json] -- <paths...>
sibyl status [--scope workspace|global|all] [--cwd <dir>] [--json]
sibyl list [--scope workspace|global|all] [--limit <n>] [--cwd <dir>] [--json]
sibyl restore <id> [--to <dest>] [--overwrite] [--cwd <dir>] [--json]
sibyl purge [--scope workspace|global|all] [--dry-run] [--cwd <dir>] [--json]
sibyl hook [--harness auto|antigravity|claude|generic]
sibyl init [--target all|antigravity|claude] [--scope workspace|global] [--update-gitignore] [--with-mcp]
sibyl mcp [--cwd <dir>]
sibyl config [--cwd <dir>] [--json]
```

> 人类管理员在终端直接调用 `sibyl purge` 时可使用 `--force`、`--all`、`--ignore-cooldown` 或 `--id <id>` 进行人工清理；当 Agent 通过 Hook 调用这些绕过参数时会被严格拒绝。

## 内置 MCP Server 工具

通过 `node skills/sibyl/scripts/sibyl.mjs mcp` 启动 stdio 服务，提供以下 5 个工具：

| 工具名 | 说明 |
| :--- | :--- |
| `sibyl_trash` | 将文件、目录或软链接安全移入 Sibyl 垃圾桶 |
| `sibyl_status` | 查询垃圾桶体积、配额使用率、冷静期受保护体积与是否允许清理 |
| `sibyl_list` | 列出垃圾桶条目 ID、原始路径、体积与冷静期状态 |
| `sibyl_restore` | 按 ID 将条目还原至原始路径或指定目标路径 |
| `sibyl_purge` | 在超配额时自治按 FIFO 清理过冷静期条目至 `50%` 水位线（不暴露绕过参数） |

## 配置说明

Sibyl 按优先级合并内置默认值、`~/.sibyl/config.json`（或 `$SIBYL_HOME/config.json`）以及 `<workspace>/.sibyl.json`：

| 配置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `trashMode` | `"workspace-first"` | 可选 `"workspace-first"`、`"global"` 或 `"custom"` |
| `customTrashDir` | `undefined` | `trashMode === "custom"` 时的自定义垃圾桶目录 |
| `workspaceTrashDirName` | `".sibyl-trash"` | 工作区本地垃圾桶目录名 |
| `maxBytes` | `1073741824`（1 GiB） | 解锁 `purge` 的垃圾桶体积上限 |
| `watermarkRatio` | `0.5`（50%） | FIFO 清理的目标安全水位线（限制在 `0.1` – `0.95`） |
| `coolDownHours` | `24` | 条目允许被自治清理前的冷静期小时数 |
| `allowDirectDeletePatterns` | `[]` | 工作区内可选直删 glob 白名单（默认关闭） |
| `purgePolicy` | `"autonomous"` | 可选 `"autonomous"`、`"ask"` 或 `"deny"` |
| `gitDestructivePolicy` | `"deny"` | 可选 `"deny"`、`"ask"` 或 `"allow"` |
| `selfProtectPolicy` | `"deny"` | 可选 `"deny"` 或 `"ask"` |

## 开发与验证

```bash
pnpm run typecheck
pnpm run build
pnpm test
```

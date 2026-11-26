English | [简体中文](./README.zh-CN.md)

# Sibyl

**Sibyl** is a universal, vendor-agnostic **Skill + Rule + Hook + Single-File CLI / MCP** safe-deletion guard for AI Agent Harnesses (Antigravity, Claude Code, and generic harnesses). It replaces accidental permanent file deletions with recoverable trash moves, blocks indirect or inline script deletion bypasses, protects its own configuration and trash directory, and provides autonomous quota-gated cleanup tailored for unattended long-running tasks.

## Background

Modern AI coding agents run with broad filesystem and shell privileges. A misplaced `rm -rf`, a glob typo, an inline script delete, or a destructive `git reset --hard` during an unattended task can permanently wipe valuable local files and uncommitted work. Sibyl adds defense-in-depth without slowing down autonomous workflows:

1. **Guidance Layer (Rule + `SessionStart` + `SKILL.md`)**: Injects concise rules at session startup and gives agents structured instructions for `trash`, `status`, `list`, `restore`, and `purge`.
2. **Interception Layer (`PreToolUse` Hook)**: Automatically rewrites simple standalone delete commands (`rm`, `rmdir`, `unlink`, `del`, `erase`, `rd`, `Remove-Item`, `ri`) into `sibyl trash`. Complex compound deletes, globs/variables, `find -delete`, `xargs rm`, inline scripts (`python -c`, `node -e`, `pwsh -Command`), destructive Git commands, and tamper attempts return actionable `deny` guidance instead of blocking unattended runs with interactive prompts.
3. **Storage & Guardrail Layer (Trash Engine)**: Keeps workspace deletions isolated inside `<workspace>/.sibyl-trash` (auto-creating `.sibyl-trash/.gitignore` containing `*` so your root `.gitignore` stays untouched) and routes out-of-workspace targets to `~/.sibyl/trash` (or `$SIBYL_HOME/trash`).
4. **Autonomous Cleanup Layer (`purge`)**: Permanent removal is unlocked only when total trash size exceeds `maxBytes` (default `1 GiB`), strictly preserves entries inside the cool-down window (`24h` default), and deletes the oldest expired items FIFO until usage drops to the safety watermark (`50%` / `512 MiB` default).

## Key Features

- **Unattended-First Deterministic Guardrails**: Zero interactive confirmation popups by default; agents receive clear replacement commands on `deny` and can self-correct autonomously.
- **Symlink & Cross-Drive Safety**: Uses `lstat` so symlinks and Windows directory junctions are moved as links only without dereferencing or deleting target contents. Cross-drive `EXDEV` moves fall back to verified recursive copy and safe source cleanup.
- **Self-Protection**: Blocks both Shell commands and file-edit tools (`write_file`, `edit_file`, `Write`, `Edit`, `MultiEdit`) from modifying or deleting `.sibyl-trash`, `.sibyl.json`, `hooks.json`, `.claude/settings.json`, or `sibyl.mjs`.
- **Single-File Zero-Dependency Bundle**: All CLI commands, Hook adapters, `init` installer, and stdio MCP server compile into `skills/sibyl/scripts/sibyl.mjs` (Node >= 18).

## Quick Start

Install dev dependencies and build the standalone bundle:

```bash
pnpm install
pnpm run build
```

Initialize Sibyl in any target project workspace (supports `antigravity`, `claude`, or `all`):

```bash
node skills/sibyl/scripts/sibyl.mjs init --target all --scope workspace --with-mcp
```

Optional `init` flags:
- `--scope global` — install into `~/.gemini/config/` and/or `~/.claude/`.
- `--update-gitignore` — also append `.sibyl-trash/` to the project root `.gitignore`.
- `--with-mcp` — print the stdio MCP server configuration snippet.

## CLI Reference

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

> Human administrators running `sibyl purge` directly in a terminal may also pass `--force`, `--all`, `--ignore-cooldown`, or `--id <id>`. The Hook layer strictly denies these bypass flags when invoked by an agent.

## Built-in MCP Server Tools

Start via `node skills/sibyl/scripts/sibyl.mjs mcp`:

| Tool | Description |
| :--- | :--- |
| `sibyl_trash` | Move files, directories, or symlinks into Sibyl trash |
| `sibyl_status` | Query trash size, quota usage, cool-down protected bytes, and purge eligibility |
| `sibyl_list` | List trashed items with IDs, original paths, sizes, and cool-down status |
| `sibyl_restore` | Restore a trashed item by ID to its original path or `--to` destination |
| `sibyl_purge` | Autonomously purge expired items FIFO down to the `50%` watermark when over quota (no bypass flags exposed) |

## Configuration

Sibyl merges built-in defaults with `~/.sibyl/config.json` (or `$SIBYL_HOME/config.json`) and `<workspace>/.sibyl.json`:

| Option | Default | Description |
| :--- | :--- | :--- |
| `trashMode` | `"workspace-first"` | `"workspace-first"`, `"global"`, or `"custom"` |
| `customTrashDir` | `undefined` | Custom trash path when `trashMode === "custom"` |
| `workspaceTrashDirName` | `".sibyl-trash"` | Workspace-local trash folder name |
| `maxBytes` | `1073741824` (1 GiB) | Trash quota threshold before `purge` unlocks |
| `watermarkRatio` | `0.5` (50%) | Target FIFO cleanup watermark (`0.1` – `0.95`) |
| `coolDownHours` | `24` | Minimum age in hours before an item can be purged |
| `allowDirectDeletePatterns` | `[]` | Optional workspace-only glob whitelist for direct deletion (disabled by default) |
| `purgePolicy` | `"autonomous"` | `"autonomous"`, `"ask"`, or `"deny"` |
| `gitDestructivePolicy` | `"deny"` | `"deny"`, `"ask"`, or `"allow"` |
| `selfProtectPolicy` | `"deny"` | `"deny"` or `"ask"` |

## Development & Verification

```bash
pnpm run typecheck
pnpm run build
pnpm test
```

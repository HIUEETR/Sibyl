English | [简体中文](./README.zh-CN.md)

# Sibyl

**Sibyl** is a universal **Skill + Rule + Hook + Single-File CLI / MCP** safe-deletion trash system designed for Agent Harnesses. It replaces accidental permanent file deletions with recoverable trash moves, blocks compound commands and inline script bypasses, protects its own configuration and trash directory from tampering, and provides autonomous quota-gated cleanup built for unattended long-running tasks.

## Background & Defense-in-Depth

Agent Harnesses run with broad filesystem and shell privileges on local machines. A single misplaced `rm -rf`, glob typo, inline script deletion, or destructive `git reset --hard` can wipe valuable files and uncommitted work. Sibyl layers four complementary defenses while keeping long unattended workflows uninterrupted:

1. **Guidance Layer (Rule + `SessionStart` + `SKILL.md`)**: `SKILL.md` activates **only** when the user explicitly triggers `/sibyl`, guiding the model to initialize hooks and rules in the current project. During daily work, installed always-on rules and `SessionStart` / `PreToolUse` hooks enforce safety automatically without misfiring the skill.
2. **Interception Layer (`PreToolUse` Hook)**: Simple standalone delete commands (`rm`, `rmdir`, `unlink`, `del`, `erase`, `rd`, `Remove-Item`, `ri`) are automatically rewritten to `sibyl trash`. Complex compound commands, globs or variable expansions, `find -delete`, `xargs rm`, inline script deletes (`python -c`, `node -e`, `pwsh -Command`), destructive Git commands, and tamper attempts return actionable `deny` guidance so the model can self-recover without blocking on human prompts.
3. **Isolated Storage Layer (Trash Engine)**: Defaults to unified workspace trash routing — targets both inside and outside the workspace are moved into `<workspace>/.sibyl-trash` (auto-creating an internal `.gitignore` with `*` on first use without modifying your root `.gitignore`). Switch `trashMode` to `"global"` or `"custom"` in config if you prefer a shared or custom trash path.
4. **Autonomous Cleanup Layer (`purge`)**: Enforces three code-level guardrails — permanent deletion unlocks only when total trash size exceeds `maxBytes` (`1 GiB` default), strictly skips entries inside the cool-down period (`24h` default), and removes the oldest expired entries FIFO until usage drops to the safety watermark (`50%` / `512 MiB` default).

## Key Features

- **Unattended-First**: No interactive `force_ask` / `ask` confirmation popups by default, keeping long autonomous tasks moving smoothly.
- **Symlink & Cross-Drive Safe**: Uses `lstat` so symlinks and Windows directory junctions are moved as links only without dereferencing or deleting targets. Cross-drive `EXDEV` moves fall back to verified recursive copy and safe source cleanup.
- **Self-Protection**: Guards both Shell commands and file-edit tools (`write_file`, `edit_file`, `Write`, `Edit`, `MultiEdit`) against modifying or deleting `.sibyl-trash`, `.sibyl.json`, `hooks.json`, `.claude/settings.json`, or `sibyl.mjs`.
- **Single-File Zero Runtime Dependencies**: CLI, Hook adapters, `init` installer, and stdio MCP server all bundle into `skills/sibyl/scripts/sibyl.mjs` (Node >= 18).

## Quick Start

### Option 1: One-Command Install via `npx` (Recommended)

Install the universal skill directly without manual cloning or building:

```bash
npx skills add HIUEETR/Sibyl
```

After installation, type `/sibyl` in your target project conversation to have the model inspect your active harness and initialize hooks and rules automatically.

You can also run the standalone CLI directly via `npx` to initialize a project:

```bash
npx github:HIUEETR/Sibyl init --target all --scope workspace --with-mcp
```

### Option 2: Build from Source & Local Init

Install dev dependencies and build the standalone bundle:

```bash
pnpm install
pnpm run build
```

Initialize Sibyl in any target project workspace (supports `antigravity`, `claude`, or `all`):

```bash
node skills/sibyl/scripts/sibyl.mjs init --target all --scope workspace --with-mcp
```

Common `init` flags:

- `--scope global`: Install into global user directories (`~/.gemini/config/` and `~/.claude/`).
- `--update-gitignore`: Also append `.sibyl-trash/` to the project root `.gitignore`.
- `--with-mcp`: Output the stdio MCP server configuration snippet.

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

> Running `sibyl purge` directly in a human terminal supports `--force`, `--all`, `--ignore-cooldown`, or `--id <id>`. The Hook layer strictly denies these bypass flags when invoked by an agent.

## Built-in MCP Server Tools

Start the stdio server via `node skills/sibyl/scripts/sibyl.mjs mcp` to expose 5 tools:

| Tool | Description |
| :--- | :--- |
| `sibyl_trash` | Safely move files, directories, or symlinks into Sibyl trash |
| `sibyl_status` | Query trash size, quota usage, cool-down protected bytes, and purge eligibility |
| `sibyl_list` | List trashed items with IDs, original paths, sizes, and cool-down status |
| `sibyl_restore` | Restore a trashed item by ID to its original path or a custom `--to` destination |
| `sibyl_purge` | Autonomously purge expired items FIFO down to the `50%` watermark when over quota (no bypass flags exposed) |

## Configuration

Sibyl merges built-in defaults, `~/.sibyl/config.json` (or `$SIBYL_HOME/config.json`), and `<workspace>/.sibyl.json`:

| Option | Default | Description |
| :--- | :--- | :--- |
| `trashMode` | `"workspace"` | `"workspace"`, `"global"`, or `"custom"` |
| `customTrashDir` | `undefined` | Custom trash directory when `trashMode === "custom"` |
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

## License

Licensed under the [MIT License](./LICENSE).

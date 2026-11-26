---
name: sibyl
description: >-
  ONLY invoke when the user explicitly triggers /sibyl. Do NOT auto-activate during normal tasks.
  Guides the agent to initialize Sibyl safe-deletion hooks, rules, and trash guard in the current
  workspace, and provides trash inspection, recovery, and cleanup commands when explicitly requested.
disable-model-invocation: true
user-invocable: true
---

# Sibyl Setup & Trash Guide

> This skill is invoked **only** when the user explicitly runs `/sibyl`. Daily safe-deletion enforcement during normal work is handled automatically by the installed `SessionStart` + `PreToolUse` hooks and always-on rules.

## 1. Initialization Workflow (Primary `/sibyl` Action)

When the user invokes `/sibyl` (especially in a fresh project or to set up/repair Sibyl):

1. Check whether Sibyl is already initialized in the current workspace (look for `.agents/hooks.json`, `.claude/settings.json`, `AGENTS.md`, or `CLAUDE.md` containing Sibyl rules/hooks).
2. If not initialized — or if the user asks to initialize or update Sibyl — locate `scripts/sibyl.mjs` relative to this skill directory and run:
   ```bash
   node "<path-to-this-skill>/scripts/sibyl.mjs" init --target all --scope workspace --with-mcp
   ```
   - Narrow `--target antigravity` or `--target claude` if the user specifies a single harness.
   - Use `--scope global` if the user explicitly asks for machine-wide installation.
   - Add `--update-gitignore` only if the user explicitly asks to append `.sibyl-trash/` to the root `.gitignore` (by default `.sibyl-trash/.gitignore` is auto-created internally).
3. Verify the installation and report active settings to the user:
   ```bash
   node "<path-to-this-skill>/scripts/sibyl.mjs" status
   node "<path-to-this-skill>/scripts/sibyl.mjs" config
   ```
4. Confirm to the user that Sibyl hooks and rules are now active and will protect normal sessions automatically without needing `/sibyl` again.

## 2. Trash Management Commands (When Explicitly Requested via `/sibyl`)

Assuming `<sibyl>` is `node "<path-to-this-skill>/scripts/sibyl.mjs"` (or use the `sibyl_*` MCP tools if configured):

- **Move files or directories to trash** (all targets, including paths outside the workspace, move into `<workspace>/.sibyl-trash` by default unless `trashMode` is set to `"global"` or `"custom"`):
  ```bash
  <sibyl> trash --reason "cleanup obsolete artifact" -- path/to/file path/to/dir
  ```
- **Check trash quota and purge eligibility**:
  ```bash
  <sibyl> status
  ```
- **List and restore accidentally trashed items**:
  ```bash
  <sibyl> list
  <sibyl> restore <id>
  <sibyl> restore <id> --to path/to/alternative
  ```
- **Quota-gated autonomous cleanup**:
  ```bash
  <sibyl> purge
  <sibyl> purge --dry-run
  ```
  `sibyl purge` only removes items permanently when total trash size exceeds `maxBytes` (`1 GiB` default), skips items inside `coolDownHours` (`24h` default), and removes the oldest expired entries FIFO until usage drops to `<= 50%` of `maxBytes`. Do not pass `--force`, `--all`, `--ignore-cooldown`, or `--id` — those flags are reserved for direct human terminal use and are denied by the hook.

## 3. Recovering from Hook Denials

- **Complex/compound delete denied** (e.g., `cd dir && rm -rf *.log`, `find -delete`, or inline script): resolve concrete paths first, then pass explicit paths to `<sibyl> trash -- <path1> <path2>`.
- **Destructive Git operation denied** (`git clean -f`, `git reset --hard`, `git checkout -- <path>`, `git restore <path>`): move untracked files with `<sibyl> trash` or back up tracked changes with `git stash push -u -m "sibyl-backup"`.
- **Self-protection denied**: never edit or delete `.sibyl-trash`, `.sibyl.json`, `hooks.json`, `.claude/settings.json`, or `sibyl.mjs`.

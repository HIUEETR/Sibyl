---
name: sibyl
description: Safe-deletion trash guard and recovery toolkit. Always move unwanted files to Sibyl trash instead of permanently deleting them, inspect trash quota, restore accidentally removed files, and run quota-gated FIFO cleanup when needed.
---

# Sibyl Safe-Deletion Guide

Never permanently delete files or directories with native commands (`rm`, `rmdir`, `unlink`, `del`, `erase`, `rd`, `Remove-Item`, `ri`, `shred`, `rimraf`), `find -delete`, `xargs rm`, or inline scripts (`python -c`, `node -e`, `pwsh -Command`). Always move unwanted paths into the Sibyl trash so everything stays recoverable.

## Core Commands

Assuming `<sibyl>` is `node "<path-to>/skills/sibyl/scripts/sibyl.mjs"` (or use the `sibyl_*` MCP tools if configured):

1. **Move files or directories to trash** (instead of deleting):
   ```bash
   <sibyl> trash --reason "cleanup obsolete build artifact" -- path/to/file path/to/dir
   ```
   - Workspace files move to `<workspace>/.sibyl-trash` (automatically git-ignored via internal `.gitignore`).
   - Out-of-workspace files move to `~/.sibyl/trash` (or `$SIBYL_HOME/trash`).
   - Symlinks and directory junctions are moved as links only without following or deleting their targets.

2. **Check trash quota and purge eligibility**:
   ```bash
   <sibyl> status
   ```
   Reports total size, item count, quota (`1 GiB` default), safety watermark (`50%` default), items protected by cool-down (`24h` default), and whether `canPurge` is true.

3. **List and restore accidentally trashed items**:
   ```bash
   <sibyl> list
   <sibyl> restore <id>
   <sibyl> restore <id> --to path/to/alternative
   ```

4. **Quota-gated autonomous cleanup**:
   ```bash
   <sibyl> purge
   <sibyl> purge --dry-run
   ```
   `sibyl purge` only deletes items permanently when **all three** guardrails hold:
   - Total trash size exceeds `maxBytes` (default `1 GiB`).
   - Items are older than `coolDownHours` (default `24h`).
   - Oldest expired items are removed strictly FIFO until total size drops to `<= 50%` of `maxBytes`.
   Do not pass `--force`, `--all`, `--ignore-cooldown`, or `--id` — those flags are reserved for human terminal use and are denied by the hook.

## Recovering from Hook Denials (Unattended Tasks)

- **Complex/compound delete denied** (e.g., `cd dir && rm -rf *.log`, `find -delete`, or inline script): list the concrete paths first, then pass explicit paths to `<sibyl> trash -- <path1> <path2>`.
- **Destructive Git operation denied** (`git clean -f`, `git reset --hard`, `git checkout -- <path>`, `git restore <path>`): move untracked files with `<sibyl> trash` or save tracked changes with `git stash push -u -m "sibyl-backup"`.
- **Self-protection denied**: never edit or delete `.sibyl-trash`, `.sibyl.json`, `hooks.json`, `.claude/settings.json`, or `sibyl.mjs`.

<!-- sibyl:begin -->
## Sibyl Safe-Deletion Policy

- **Never permanently delete files or directories** using native commands (`rm`, `rmdir`, `unlink`, `del`, `Remove-Item`, `git clean -f`, `git reset --hard`) or inline scripts (`python -c`, `node -e`).
- Always move unwanted paths to the Sibyl trash instead: `node "<path-to-sibyl.mjs>" trash -- <paths>` (or call the `sibyl_trash` MCP tool).
- Query trash quota with `node "<path-to-sibyl.mjs>" status`, inspect/recover with `list` and `restore <id>`, and run quota-gated cleanup with `purge`.
<!-- sibyl:end -->

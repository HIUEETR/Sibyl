import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleHookPayload } from "./adapters/harness.js";
import { loadConfig } from "./core/config.js";
import { resolveWorkspaceRoot } from "./core/paths.js";
import {
  getStatus,
  listItems,
  purgeTrash,
  restoreItem,
  trashPaths,
  type TrashScope,
} from "./core/trash-service.js";
import { runInit, type InitScope, type InitTarget } from "./init/installer.js";
import { startMcpServer } from "./mcp/server.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let idx = -1;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(2)} ${units[idx]}`;
}

function getRuntimeScriptPath(): string {
  return path.resolve(fileURLToPath(import.meta.url));
}

function getSourceSkillDir(): string {
  const scriptPath = getRuntimeScriptPath();
  // When running from skills/sibyl/scripts/sibyl.mjs, parent of scripts/ is skills/sibyl
  const candidate = path.resolve(path.dirname(scriptPath), "..");
  if (fs.existsSync(path.join(candidate, "SKILL.md"))) {
    return candidate;
  }
  // When running from dist/sibyl.mjs, locate repo skills/sibyl
  const repoCandidate = path.resolve(path.dirname(scriptPath), "..", "skills", "sibyl");
  if (fs.existsSync(path.join(repoCandidate, "SKILL.md"))) {
    return repoCandidate;
  }
  return candidate;
}

function printHelp(): void {
  console.log(
    [
      "Sibyl — Safe-deletion trash CLI, Hook guard & MCP server",
      "",
      "Usage:",
      "  sibyl trash [--cwd <dir>] [--reason <text>] [--json] -- <paths...>",
      "  sibyl status [--scope workspace|global|all] [--cwd <dir>] [--json]",
      "  sibyl list [--scope workspace|global|all] [--limit <n>] [--cwd <dir>] [--json]",
      "  sibyl restore <id> [--to <dest>] [--overwrite] [--cwd <dir>] [--json]",
      "  sibyl purge [--scope workspace|global|all] [--dry-run] [--cwd <dir>] [--json]",
      "              (Human terminal overrides: --force, --all, --ignore-cooldown, --id <id>)",
      "  sibyl hook [--harness auto|antigravity|claude|generic]",
      "  sibyl init [--target all|antigravity|claude] [--scope workspace|global] [--update-gitignore] [--with-mcp]",
      "  sibyl mcp [--cwd <dir>]",
      "  sibyl config [--cwd <dir>] [--json]",
    ].join("\n")
  );
}

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseFlags(argv: string[]): { flags: Map<string, string | boolean>; positional: string[] } {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  let afterDoubleDash = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!afterDoubleDash && arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        flags.set(arg.slice(2, eqIdx), arg.slice(eqIdx + 1));
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (
          next !== undefined &&
          !next.startsWith("-") &&
          (key === "cwd" ||
            key === "reason" ||
            key === "session-id" ||
            key === "scope" ||
            key === "limit" ||
            key === "to" ||
            key === "id" ||
            key === "harness" ||
            key === "target")
        ) {
          flags.set(key, next);
          i += 1;
        } else {
          flags.set(key, true);
        }
      }
      continue;
    }
    if (!afterDoubleDash && arg === "-f") {
      flags.set("force", true);
      continue;
    }
    if (!afterDoubleDash && arg === "-h") {
      flags.set("help", true);
      continue;
    }
    positional.push(arg);
  }

  return { flags, positional };
}

function asScope(val: string | boolean | undefined): TrashScope {
  if (val === "workspace" || val === "global" || val === "all") {
    return val;
  }
  return "all";
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printHelp();
    return;
  }

  const { flags, positional } = parseFlags(argv.slice(1));
  if (flags.get("help")) {
    printHelp();
    return;
  }

  const asJson = Boolean(flags.get("json"));
  const cwd = typeof flags.get("cwd") === "string" ? path.resolve(String(flags.get("cwd"))) : process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const config = loadConfig(workspaceRoot);

  switch (subcommand) {
    case "trash": {
      if (positional.length === 0) {
        throw new Error("No paths provided. Usage: sibyl trash -- <paths...>");
      }
      const res = await trashPaths(positional, {
        cwd,
        workspaceRoot,
        config,
        reason: typeof flags.get("reason") === "string" ? String(flags.get("reason")) : undefined,
        sessionId:
          typeof flags.get("session-id") === "string" ? String(flags.get("session-id")) : undefined,
      });
      if (asJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        for (const item of res.moved) {
          console.log(
            `Trashed [${item.id}] ${item.originalPath} -> ${path.join(item.trashRoot, item.storedRelPath)} (${formatBytes(item.sizeBytes)})`
          );
        }
        console.log(
          `Trash usage: ${formatBytes(res.status.totalBytes)} / ${formatBytes(res.status.maxBytes)} (${(res.status.usageRatio * 100).toFixed(1)}%)`
        );
        if (res.status.quotaExceeded) {
          console.log("Notice: Trash quota exceeded. Run `sibyl purge` to clean expired entries.");
        }
      }
      return;
    }

    case "status": {
      const status = getStatus({ scope: asScope(flags.get("scope")), workspaceRoot, config });
      if (asJson) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(`Sibyl Trash Status (scope: ${status.scope})`);
        console.log(`  Items:           ${status.itemCount}`);
        console.log(
          `  Total size:      ${formatBytes(status.totalBytes)} / ${formatBytes(status.maxBytes)} (${(status.usageRatio * 100).toFixed(1)}%)`
        );
        console.log(
          `  Watermark:       ${(status.watermarkRatio * 100).toFixed(0)}% (${formatBytes(status.watermarkBytes)})`
        );
        console.log(`  Quota exceeded:  ${status.quotaExceeded ? "YES" : "no"}`);
        console.log(
          `  Cool-down:       ${status.coolDownHours}h (${status.protectedCount} protected / ${formatBytes(status.protectedBytes)}, ${status.purgeableCount} purgeable / ${formatBytes(status.purgeableBytes)})`
        );
        console.log(`  Can auto-purge:  ${status.canPurge ? "YES" : "no"}`);
        if (status.earliestUnlockAt) {
          console.log(`  Earliest unlock: ${status.earliestUnlockAt}`);
        }
      }
      return;
    }

    case "list": {
      const limit =
        typeof flags.get("limit") === "string" ? Number(flags.get("limit")) : undefined;
      const items = listItems({
        scope: asScope(flags.get("scope")),
        workspaceRoot,
        config,
        limit,
      });
      if (asJson) {
        console.log(JSON.stringify(items, null, 2));
      } else if (items.length === 0) {
        console.log("Sibyl trash is empty.");
      } else {
        for (const item of items) {
          const state = item.inCoolDown ? "cooldown" : "purgeable";
          console.log(
            `${item.id}  ${formatBytes(item.sizeBytes).padStart(10)}  [${item.entryType}]  [${state}]  ${item.originalPath}`
          );
        }
      }
      return;
    }

    case "restore": {
      const id = positional[0];
      if (!id) {
        throw new Error("Missing trash ID. Usage: sibyl restore <id> [--to <dest>] [--overwrite]");
      }
      const res = await restoreItem(id, {
        to: typeof flags.get("to") === "string" ? String(flags.get("to")) : undefined,
        overwrite: Boolean(flags.get("overwrite")),
        cwd,
        workspaceRoot,
        config,
      });
      if (asJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(`Restored [${res.item.id}] -> ${res.restoredTo}`);
        if (res.overwrittenBackupId) {
          console.log(`Previous file at destination backed up as [${res.overwrittenBackupId}]`);
        }
      }
      return;
    }

    case "purge": {
      const res = await purgeTrash({
        scope: asScope(flags.get("scope")),
        workspaceRoot,
        config,
        dryRun: Boolean(flags.get("dry-run")),
        force: Boolean(flags.get("force")),
        all: Boolean(flags.get("all")),
        ignoreCooldown: Boolean(flags.get("ignore-cooldown")),
        id: typeof flags.get("id") === "string" ? String(flags.get("id")) : undefined,
      });
      if (asJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(`Purge result: ${res.status}`);
        console.log(
          `  Deleted: ${res.deleted.length} item(s), freed ${formatBytes(res.freedBytes)}`
        );
        console.log(
          `  Size:    ${formatBytes(res.totalBytesBefore)} -> ${formatBytes(res.totalBytesAfter)} (quota ${formatBytes(res.maxBytes)}, watermark ${formatBytes(res.watermarkBytes)})`
        );
        if (res.earliestUnlockAt) {
          console.log(`  Earliest cool-down unlock: ${res.earliestUnlockAt}`);
        }
      }
      return;
    }

    case "hook": {
      const explicitHarness =
        typeof flags.get("harness") === "string" ? String(flags.get("harness")) : undefined;
      try {
        const raw = await readStdinText();
        const payload = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
        const output = handleHookPayload(payload, {
          explicitHarness,
          runtimePath: getRuntimeScriptPath(),
          fallbackCwd: cwd,
        });
        process.stdout.write(JSON.stringify(output) + "\n");
      } catch (err) {
        // Fail safely with valid hook JSON so harness loop never receives invalid stdout.
        const fallbackOut =
          explicitHarness === "claude"
            ? {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason: `Sibyl hook internal error: ${(err as Error).message}`,
                },
              }
            : {
                decision: "deny",
                reason: `Sibyl hook internal error: ${(err as Error).message}`,
              };
        process.stdout.write(JSON.stringify(fallbackOut) + "\n");
      }
      return;
    }

    case "init": {
      const targetArg = typeof flags.get("target") === "string" ? String(flags.get("target")) : "all";
      const scopeArg =
        typeof flags.get("scope") === "string" ? String(flags.get("scope")) : "workspace";
      const target: InitTarget =
        targetArg === "antigravity" || targetArg === "claude" || targetArg === "all"
          ? targetArg
          : "all";
      const scope: InitScope = scopeArg === "global" ? "global" : "workspace";

      const report = runInit({
        target,
        scope,
        cwd,
        updateGitignore: Boolean(flags.get("update-gitignore")),
        withMcp: Boolean(flags.get("with-mcp")),
        sourceSkillDir: getSourceSkillDir(),
      });
      if (asJson) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`Initialized Sibyl (target: ${report.target}, scope: ${report.scope})`);
        for (const f of report.updatedFiles) {
          console.log(`  - ${f}`);
        }
        if (report.mcpConfig) {
          console.log("\nOptional MCP Server config:");
          console.log(JSON.stringify(report.mcpConfig, null, 2));
        }
      }
      return;
    }

    case "mcp": {
      await startMcpServer(cwd);
      return;
    }

    case "config": {
      if (asJson) {
        console.log(JSON.stringify({ workspaceRoot, config }, null, 2));
      } else {
        console.log(`Workspace root: ${workspaceRoot}`);
        console.log(JSON.stringify(config, null, 2));
      }
      return;
    }

    default:
      throw new Error(`Unknown subcommand: ${subcommand}. Run \`sibyl --help\` for usage.`);
  }
}

main().catch((err) => {
  console.error(`Error: ${(err as Error).message}`);
  process.exitCode = 1;
});

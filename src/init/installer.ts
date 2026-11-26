import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { toForwardSlashes } from "../core/paths.js";

export type InitTarget = "antigravity" | "claude" | "all";
export type InitScope = "workspace" | "global";

export interface InitOptions {
  target: InitTarget;
  scope: InitScope;
  cwd: string;
  updateGitignore?: boolean;
  withMcp?: boolean;
  sourceSkillDir: string;
}

export interface InitReport {
  target: InitTarget;
  scope: InitScope;
  updatedFiles: string[];
  mcpConfig?: Record<string, unknown>;
}

const RULE_BEGIN = "<!-- sibyl:begin -->";
const RULE_END = "<!-- sibyl:end -->";

function copyDirRecursive(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      if (process.platform !== "win32" && entry.name.endsWith(".mjs")) {
        fs.chmodSync(destPath, 0o755);
      }
    }
  }
}

function readJsonOrEmpty(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object in ${filePath}`);
  }
  return parsed as Record<string, unknown>;
}

function writeJsonPretty(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function buildRuleBlock(runtimeScriptPath: string): string {
  const rt = toForwardSlashes(runtimeScriptPath);
  return [
    RULE_BEGIN,
    "## Sibyl Safe-Deletion Policy",
    "",
    "- **Never permanently delete files or directories** using native commands (`rm`, `rmdir`, `unlink`, `del`, `Remove-Item`, `git clean -f`, `git reset --hard`) or inline scripts (`python -c`, `node -e`).",
    `- Always move unwanted paths to the Sibyl trash instead: \`node "${rt}" trash -- <paths>\` (or call the \`sibyl_trash\` MCP tool).`,
    `- Query trash quota with \`node "${rt}" status\`, inspect/recover with \`list\` and \`restore <id>\`, and run quota-gated cleanup with \`purge\`.`,
    RULE_END,
  ].join("\n");
}

function upsertRuleMarkdown(filePath: string, block: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, block + "\n", "utf8");
    return;
  }
  const existing = fs.readFileSync(filePath, "utf8");
  const startIdx = existing.indexOf(RULE_BEGIN);
  const endIdx = existing.indexOf(RULE_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const updated =
      existing.slice(0, startIdx) + block + existing.slice(endIdx + RULE_END.length);
    fs.writeFileSync(filePath, updated, "utf8");
    return;
  }
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  fs.writeFileSync(filePath, existing + sep + block + "\n", "utf8");
}

function installAntigravityHooks(
  hooksJsonPath: string,
  runtimeScriptPath: string
): void {
  const data = readJsonOrEmpty(hooksJsonPath);
  const hookCmd = `node "${toForwardSlashes(runtimeScriptPath)}" hook --harness antigravity`;
  data["sibyl-guard"] = {
    enabled: true,
    SessionStart: [
      {
        type: "command",
        command: hookCmd,
        timeout: 10,
      },
    ],
    PreToolUse: [
      {
        matcher: "run_command|write_file|edit_file",
        hooks: [
          {
            type: "command",
            command: hookCmd,
            timeout: 10,
          },
        ],
      },
    ],
  };
  writeJsonPretty(hooksJsonPath, data);
}

function isSibylClaudeHookGroup(group: unknown): boolean {
  if (!group || typeof group !== "object") {
    return false;
  }
  const hooks = (group as { hooks?: unknown }).hooks;
  if (!Array.isArray(hooks)) {
    return false;
  }
  return hooks.some(
    (h) =>
      h &&
      typeof h === "object" &&
      typeof (h as { command?: unknown }).command === "string" &&
      (h as { command: string }).command.includes("sibyl.mjs")
  );
}

function installClaudeHooks(settingsPath: string, runtimeScriptPath: string): void {
  const data = readJsonOrEmpty(settingsPath);
  const hookCmd = `node "${toForwardSlashes(runtimeScriptPath)}" hook --harness claude`;
  const hooksObj =
    data.hooks && typeof data.hooks === "object" && !Array.isArray(data.hooks)
      ? ({ ...(data.hooks as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  const existingSession = Array.isArray(hooksObj.SessionStart) ? hooksObj.SessionStart : [];
  const filteredSession = existingSession.filter((g) => !isSibylClaudeHookGroup(g));
  filteredSession.push({
    hooks: [{ type: "command", command: hookCmd, timeout: 10 }],
  });
  hooksObj.SessionStart = filteredSession;

  const existingPre = Array.isArray(hooksObj.PreToolUse) ? hooksObj.PreToolUse : [];
  const filteredPre = existingPre.filter((g) => !isSibylClaudeHookGroup(g));
  filteredPre.push({
    matcher: "Bash|Write|Edit|MultiEdit",
    hooks: [{ type: "command", command: hookCmd, timeout: 10 }],
  });
  hooksObj.PreToolUse = filteredPre;

  data.hooks = hooksObj;
  writeJsonPretty(settingsPath, data);
}

function appendRootGitignore(workspaceRoot: string): boolean {
  const gitignorePath = path.join(workspaceRoot, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, ".sibyl-trash/\n", "utf8");
    return true;
  }
  const raw = fs.readFileSync(gitignorePath, "utf8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  if (lines.includes(".sibyl-trash/") || lines.includes(".sibyl-trash")) {
    return false;
  }
  const sep = raw.endsWith("\n") || raw.length === 0 ? "" : "\n";
  fs.writeFileSync(gitignorePath, `${raw}${sep}.sibyl-trash/\n`, "utf8");
  return true;
}

export function runInit(opts: InitOptions): InitReport {
  const updatedFiles: string[] = [];
  const workspaceRoot = path.resolve(opts.cwd);
  const homeDir = os.homedir();
  const targets: Array<"antigravity" | "claude"> =
    opts.target === "all" ? ["antigravity", "claude"] : [opts.target];

  let lastRuntimeScript = path.join(opts.sourceSkillDir, "scripts", "sibyl.mjs");

  for (const t of targets) {
    if (t === "antigravity") {
      const baseDir =
        opts.scope === "workspace"
          ? path.join(workspaceRoot, ".agents")
          : path.join(homeDir, ".gemini", "config");
      const skillDest = path.join(baseDir, "skills", "sibyl");
      if (path.resolve(opts.sourceSkillDir) !== path.resolve(skillDest)) {
        copyDirRecursive(opts.sourceSkillDir, skillDest);
        updatedFiles.push(skillDest);
      }
      const runtimeScript = path.join(skillDest, "scripts", "sibyl.mjs");
      lastRuntimeScript = runtimeScript;

      const hooksPath = path.join(baseDir, "hooks.json");
      installAntigravityHooks(hooksPath, runtimeScript);
      updatedFiles.push(hooksPath);

      if (opts.scope === "workspace") {
        const agentsMd = path.join(workspaceRoot, "AGENTS.md");
        upsertRuleMarkdown(agentsMd, buildRuleBlock(runtimeScript));
        updatedFiles.push(agentsMd);
      }
    } else {
      const baseDir =
        opts.scope === "workspace"
          ? path.join(workspaceRoot, ".claude")
          : path.join(homeDir, ".claude");
      const skillDest = path.join(baseDir, "skills", "sibyl");
      if (path.resolve(opts.sourceSkillDir) !== path.resolve(skillDest)) {
        copyDirRecursive(opts.sourceSkillDir, skillDest);
        updatedFiles.push(skillDest);
      }
      const runtimeScript = path.join(skillDest, "scripts", "sibyl.mjs");
      lastRuntimeScript = runtimeScript;

      const settingsPath = path.join(baseDir, "settings.json");
      installClaudeHooks(settingsPath, runtimeScript);
      updatedFiles.push(settingsPath);

      if (opts.scope === "workspace") {
        const claudeMd = path.join(workspaceRoot, "CLAUDE.md");
        upsertRuleMarkdown(claudeMd, buildRuleBlock(runtimeScript));
        updatedFiles.push(claudeMd);
      }
    }
  }

  if (opts.scope === "workspace" && opts.updateGitignore) {
    const gitignorePath = path.join(workspaceRoot, ".gitignore");
    if (appendRootGitignore(workspaceRoot)) {
      updatedFiles.push(gitignorePath);
    }
  }

  let mcpConfig: Record<string, unknown> | undefined;
  if (opts.withMcp) {
    mcpConfig = {
      mcpServers: {
        sibyl: {
          command: "node",
          args: [toForwardSlashes(lastRuntimeScript), "mcp"],
        },
      },
    };
  }

  return {
    target: opts.target,
    scope: opts.scope,
    updatedFiles,
    mcpConfig,
  };
}

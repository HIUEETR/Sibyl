import path from "node:path";
import { loadConfig } from "../core/config.js";
import { resolveWorkspaceRoot, toForwardSlashes } from "../core/paths.js";
import { evaluateCommand, evaluateFileWrite, type PolicyDecision } from "../policy/analyzer.js";

export type HarnessKind = "antigravity" | "claude" | "generic";

export interface HookHandleOptions {
  explicitHarness?: string;
  runtimePath: string;
  fallbackCwd?: string;
}

export function detectHarness(
  payload: Record<string, unknown>,
  explicit?: string
): HarnessKind {
  if (explicit === "antigravity" || explicit === "claude" || explicit === "generic") {
    return explicit;
  }
  if ("toolCall" in payload || "hookEventName" in payload) {
    return "antigravity";
  }
  if ("tool_name" in payload || "hook_event_name" in payload) {
    return "claude";
  }
  return "generic";
}

function extractCwd(payload: Record<string, unknown>, fallbackCwd: string): string {
  if (typeof payload.cwd === "string" && payload.cwd.trim()) {
    return payload.cwd;
  }
  if (Array.isArray(payload.workspacePaths) && typeof payload.workspacePaths[0] === "string") {
    return payload.workspacePaths[0];
  }
  return fallbackCwd;
}

function extractExplicitWorkspace(payload: Record<string, unknown>): string | undefined {
  if (Array.isArray(payload.workspacePaths) && typeof payload.workspacePaths[0] === "string") {
    return payload.workspacePaths[0];
  }
  return undefined;
}

function buildSessionStartMessage(runtimePath: string): string {
  const rt = toForwardSlashes(runtimePath);
  return (
    "Sibyl safe-deletion guard is active. Never delete files directly with rm/del/Remove-Item or inline scripts. " +
    `Move unwanted files to trash using \`node "${rt}" trash -- <paths>\` (or the sibyl_trash MCP tool). ` +
    "Use `status`, `list`, `restore <id>`, and quota-gated `purge` (1 GiB limit, 24h cool-down, 50% FIFO watermark) when managing trash."
  );
}

function mapDecisionToHarness(
  decision: PolicyDecision,
  harness: HarnessKind,
  eventName: string
): Record<string, unknown> {
  if (harness === "antigravity") {
    if (decision.action === "allow") {
      return { decision: "allow" };
    }
    if (decision.action === "rewrite" && decision.rewrittenCommand) {
      return {
        decision: "allow",
        reason: decision.reason,
        overwrite: {
          CommandLine: decision.rewrittenCommand,
        },
      };
    }
    if (decision.action === "ask") {
      return {
        decision: "force_ask",
        reason: decision.reason ?? "Requires confirmation.",
      };
    }
    return {
      decision: "deny",
      reason: decision.reason ?? "Blocked by Sibyl safe-deletion guard.",
    };
  }

  if (harness === "claude") {
    const hookEventName = eventName || "PreToolUse";
    if (decision.action === "allow") {
      return {
        hookSpecificOutput: {
          hookEventName,
          permissionDecision: "allow",
        },
      };
    }
    if (decision.action === "rewrite" && decision.rewrittenCommand) {
      return {
        hookSpecificOutput: {
          hookEventName,
          permissionDecision: "allow",
          permissionDecisionReason: decision.reason,
          updatedInput: {
            command: decision.rewrittenCommand,
          },
        },
      };
    }
    if (decision.action === "ask") {
      return {
        hookSpecificOutput: {
          hookEventName,
          permissionDecision: "ask",
          permissionDecisionReason: decision.reason ?? "Requires confirmation.",
        },
      };
    }
    return {
      hookSpecificOutput: {
        hookEventName,
        permissionDecision: "deny",
        permissionDecisionReason: decision.reason ?? "Blocked by Sibyl safe-deletion guard.",
      },
    };
  }

  // Generic harness fallback: cannot reliably rewrite tool args, so downgrade rewrite -> deny with command.
  if (decision.action === "allow") {
    return { decision: "allow" };
  }
  if (decision.action === "rewrite") {
    return {
      decision: "deny",
      reason:
        decision.reason ??
        `Blocked native deletion. Run this instead: ${decision.rewrittenCommand ?? ""}`,
    };
  }
  if (decision.action === "ask") {
    return { decision: "ask", reason: decision.reason };
  }
  return {
    decision: "deny",
    reason: decision.reason ?? "Blocked by Sibyl safe-deletion guard.",
  };
}

export function handleHookPayload(
  payload: Record<string, unknown>,
  options: HookHandleOptions
): Record<string, unknown> {
  const harness = detectHarness(payload, options.explicitHarness);
  const fallbackCwd = options.fallbackCwd ?? process.cwd();
  const cwd = extractCwd(payload, fallbackCwd);
  const workspaceRoot = resolveWorkspaceRoot(cwd, extractExplicitWorkspace(payload));
  const config = loadConfig(workspaceRoot);
  const runtimePath = path.resolve(options.runtimePath);

  const eventName =
    typeof payload.hookEventName === "string"
      ? payload.hookEventName
      : typeof payload.hook_event_name === "string"
        ? payload.hook_event_name
        : "PreToolUse";

  if (eventName === "SessionStart") {
    const msg = buildSessionStartMessage(runtimePath);
    if (harness === "antigravity") {
      return {
        injectSteps: [
          {
            systemMessage: {
              systemMessage: msg,
            },
          },
        ],
      };
    }
    if (harness === "claude") {
      return {
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: msg,
        },
      };
    }
    return { decision: "allow", message: msg };
  }

  if (eventName !== "PreToolUse") {
    return {};
  }

  let toolName = "";
  let toolArgs: Record<string, unknown> = {};

  if (payload.toolCall && typeof payload.toolCall === "object") {
    const tc = payload.toolCall as Record<string, unknown>;
    if (typeof tc.name === "string") toolName = tc.name;
    if (tc.args && typeof tc.args === "object") toolArgs = tc.args as Record<string, unknown>;
  } else {
    if (typeof payload.tool_name === "string") toolName = payload.tool_name;
    if (payload.tool_input && typeof payload.tool_input === "object") {
      toolArgs = payload.tool_input as Record<string, unknown>;
    }
  }

  const normalizedTool = toolName.toLowerCase();

  // Shell execution tools
  if (normalizedTool === "run_command" || normalizedTool === "bash") {
    const cmd =
      typeof toolArgs.CommandLine === "string"
        ? toolArgs.CommandLine
        : typeof toolArgs.command === "string"
          ? toolArgs.command
          : "";
    const decision = evaluateCommand({
      commandLine: cmd,
      cwd,
      workspaceRoot,
      config,
      runtimePath,
    });
    return mapDecisionToHarness(decision, harness, eventName);
  }

  // File write / edit tools
  if (
    normalizedTool === "write_file" ||
    normalizedTool === "edit_file" ||
    normalizedTool === "write" ||
    normalizedTool === "edit" ||
    normalizedTool === "multiedit"
  ) {
    const targetPath =
      typeof toolArgs.Path === "string"
        ? toolArgs.Path
        : typeof toolArgs.file_path === "string"
          ? toolArgs.file_path
          : typeof toolArgs.path === "string"
            ? toolArgs.path
            : "";
    const decision = evaluateFileWrite({
      targetPath,
      cwd,
      workspaceRoot,
      config,
      runtimePath,
    });
    return mapDecisionToHarness(decision, harness, eventName);
  }

  return mapDecisionToHarness({ action: "allow" }, harness, eventName);
}

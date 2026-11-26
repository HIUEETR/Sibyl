import path from "node:path";
import type { SibylConfig } from "../core/config.js";
import {
  getProtectedPaths,
  isPathInside,
  matchesDirectDeletePattern,
  normalizeForCompare,
  toForwardSlashes,
} from "../core/paths.js";
import { parseCommandLine, type ParsedSegment, type ParsedToken } from "./shell-parser.js";

export type PolicyAction = "allow" | "rewrite" | "deny" | "ask";

export interface PolicyDecision {
  action: PolicyAction;
  rewrittenCommand?: string;
  reason?: string;
  category?: string;
}

const SIMPLE_DELETE_VERBS = new Set([
  "rm",
  "rmdir",
  "unlink",
  "del",
  "erase",
  "rd",
  "remove-item",
  "ri",
]);

const COMPLEX_ONLY_DELETE_VERBS = new Set([
  "shred",
  "rimraf",
  "srm",
  "clear-recyclebin",
  "trash-empty",
]);

const INLINE_SCRIPT_RUNNERS = new Set([
  "python",
  "python3",
  "py",
  "node",
  "bun",
  "deno",
  "pwsh",
  "powershell",
  "perl",
  "ruby",
  "cmd",
  "sh",
  "bash",
  "zsh",
]);

const INLINE_DESTRUCTIVE_REGEXES: RegExp[] = [
  /\bos\.(remove|unlink|rmdir|removedirs)\b/i,
  /\bshutil\.rmtree\b/i,
  /\bPath\([^)]*\)\.(unlink|rmdir)\b/i,
  /\bfs\.(rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)\b/i,
  /\bfs\.promises\.(rm|unlink|rmdir)\b/i,
  /\bBun\.file\([^)]*\)\.delete\b/i,
  /\bDeno\.(remove|removeSync)\b/i,
  /\b(Remove-Item|ri)\b/i,
  /\[System\.IO\.(File|Directory)\]::Delete\b/i,
  /\bFile::Path\b|\bunlink\s+/i,
  /\bFileUtils\.(rm|rm_rf|rm_r)\b/i,
  /(?:^|[;&|]\s*)(rm|del|erase|rd|rmdir|Remove-Item)\b/i,
];

const MUTATING_VERBS = new Set([
  ...SIMPLE_DELETE_VERBS,
  ...COMPLEX_ONLY_DELETE_VERBS,
  "mv",
  "move",
  "move-item",
  "mi",
  "cp",
  "copy",
  "copy-item",
  "tee",
  "sed",
  "truncate",
  "chmod",
  "chown",
  "attrib",
  "set-content",
  "add-content",
  "out-file",
  "clear-content",
  "sc",
  "ac",
  "touch",
  "git",
]);

const SAFE_POSIX_DELETE_FLAGS = new Set([
  "-f",
  "-r",
  "-R",
  "-v",
  "-d",
  "-i",
  "-I",
  "--force",
  "--recursive",
  "--verbose",
  "--dir",
  "--interactive",
]);

const SAFE_PS_DELETE_FLAGS = new Set([
  "-recurse",
  "-force",
  "-verbose",
  "-confirm:$false",
  "-confirm",
]);

const SAFE_PS_VALUE_FLAGS = new Set(["-path", "-literalpath"]);

const SAFE_CMD_DELETE_FLAGS = new Set(["/f", "/s", "/q", "/p"]);

const PURGE_BYPASS_FLAGS = new Set(["--force", "-f", "--all", "--ignore-cooldown", "--id"]);

function quoteShellArg(arg: string): string {
  const escaped = arg.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function buildTrashCommand(runtimePath: string, cwd: string, targets: string[]): string {
  const rt = toForwardSlashes(runtimePath);
  const normCwd = toForwardSlashes(cwd);
  const quotedTargets = targets.map((t) => quoteShellArg(t)).join(" ");
  return `node ${quoteShellArg(rt)} trash --from-hook --cwd ${quoteShellArg(normCwd)} -- ${quotedTargets}`;
}

function isSibylInvocation(
  segment: ParsedSegment,
  runtimePath: string
): { isSibyl: true; subcommand: string; args: ParsedToken[] } | { isSibyl: false } {
  const v = segment.verbLower;
  if (v === "sibyl") {
    const sub = segment.args[0]?.value.toLowerCase() ?? "";
    return { isSibyl: true, subcommand: sub, args: segment.args.slice(1) };
  }
  if ((v === "node" || v === "bun") && segment.args.length >= 1) {
    const scriptArg = segment.args[0].value;
    const base = path.posix.basename(toForwardSlashes(scriptArg)).toLowerCase();
    if (
      base === "sibyl.mjs" ||
      normalizeForCompare(path.resolve(scriptArg)) === normalizeForCompare(runtimePath)
    ) {
      const sub = segment.args[1]?.value.toLowerCase() ?? "";
      return { isSibyl: true, subcommand: sub, args: segment.args.slice(2) };
    }
  }
  return { isSibyl: false };
}

function unwrapShellWrapper(segment: ParsedSegment): { verbLower: string; inlineCode?: string } {
  const v = segment.verbLower;
  if (!INLINE_SCRIPT_RUNNERS.has(v)) {
    return { verbLower: v };
  }
  for (let i = 0; i < segment.args.length; i += 1) {
    const a = segment.args[i].value.toLowerCase();
    if (a === "-c" || a === "-e" || a === "/c" || a === "-command" || a === "-encodedcommand") {
      return {
        verbLower: v,
        inlineCode: segment.args
          .slice(i + 1)
          .map((t) => t.value)
          .join(" "),
      };
    }
  }
  return { verbLower: v };
}

function tokenReferencesProtectedPath(
  tokenValue: string,
  cwd: string,
  protectedPaths: string[]
): boolean {
  if (!tokenValue || tokenValue.startsWith("-")) {
    return false;
  }
  const trimmed = tokenValue.trim();
  if (!trimmed) {
    return false;
  }

  // Exact or resolved path match against protected paths (inside or ancestor deletion)
  const resolved = path.resolve(cwd, trimmed);
  for (const prot of protectedPaths) {
    if (isPathInside(resolved, prot) || isPathInside(prot, resolved)) {
      return true;
    }
  }

  // Also catch substring references inside inline scripts or redirection targets
  const normToken = toForwardSlashes(trimmed).toLowerCase();
  for (const prot of protectedPaths) {
    const normProt = toForwardSlashes(prot).toLowerCase();
    const protBase = path.posix.basename(normProt);
    if (normToken.includes(normProt)) {
      return true;
    }
    if (
      (protBase === ".sibyl-trash" ||
        protBase === ".sibyl.json" ||
        protBase === "sibyl.mjs" ||
        protBase === "hooks.json") &&
      normToken.includes(protBase)
    ) {
      return true;
    }
  }

  return false;
}

function commandTouchesProtectedPaths(
  segments: ParsedSegment[],
  rawCommand: string,
  cwd: string,
  protectedPaths: string[],
  runtimePath: string
): boolean {
  const lowerRaw = rawCommand.toLowerCase();
  const hasMutationHint =
    segments.some(
      (seg) =>
        MUTATING_VERBS.has(seg.verbLower) ||
        seg.hasRedirection ||
        INLINE_SCRIPT_RUNNERS.has(seg.verbLower)
    ) ||
    />/.test(rawCommand);

  if (!hasMutationHint) {
    return false;
  }

  for (const seg of segments) {
    // Allow valid standalone sibyl CLI execution referencing sibyl.mjs itself
    if (!seg.hasRedirection && segments.length === 1) {
      const sibylCheck = isSibylInvocation(seg, runtimePath);
      if (sibylCheck.isSibyl) {
        // Still block if sibyl trash tries to trash a protected path
        if (sibylCheck.subcommand === "trash") {
          for (const arg of sibylCheck.args) {
            if (tokenReferencesProtectedPath(arg.value, cwd, protectedPaths)) {
              return true;
            }
          }
        }
        return false;
      }
    }

    for (const tok of seg.tokens.slice(1)) {
      if (tokenReferencesProtectedPath(tok.value, cwd, protectedPaths)) {
        return true;
      }
    }
  }

  // Fallback raw substring check for redirection like `echo '{}' > .agents/hooks.json`
  for (const prot of protectedPaths) {
    const base = path.basename(prot).toLowerCase();
    const normProt = toForwardSlashes(prot).toLowerCase();
    if (
      (lowerRaw.includes(normProt) ||
        (base !== "sibyl" &&
          (base === ".sibyl-trash" ||
            base === ".sibyl.json" ||
            base === "sibyl.mjs" ||
            base === "hooks.json" ||
            base === "settings.json" ||
            base === "settings.local.json") &&
          lowerRaw.includes(base))) &&
      (/>/.test(rawCommand) ||
        segments.some(
          (s) =>
            MUTATING_VERBS.has(s.verbLower) ||
            INLINE_SCRIPT_RUNNERS.has(s.verbLower)
        ))
    ) {
      return true;
    }
  }

  return false;
}

function parseSimpleDeleteTargets(
  segment: ParsedSegment
): { valid: true; targets: string[] } | { valid: false; reason: string } {
  const verb = segment.verbLower;
  if (!SIMPLE_DELETE_VERBS.has(verb)) {
    return { valid: false, reason: "Not a simple delete verb" };
  }

  const targets: string[] = [];
  let afterDoubleDash = false;

  for (let i = 0; i < segment.args.length; i += 1) {
    const tok = segment.args[i];
    const val = tok.value;

    if (tok.hasExpansion || tok.hasGlob || /[\r\n$`]/.test(val)) {
      return { valid: false, reason: "Contains dynamic expansion, glob, or unsafe shell character" };
    }

    if (!afterDoubleDash && val === "--") {
      afterDoubleDash = true;
      continue;
    }

    if (!afterDoubleDash) {
      const lower = val.toLowerCase();
      if (verb === "rm" || verb === "rmdir" || verb === "unlink") {
        if (SAFE_POSIX_DELETE_FLAGS.has(val)) {
          continue;
        }
        // Combined short POSIX flags like -rf, -fr, -rvf
        if (/^-[frRviId]+$/.test(val)) {
          continue;
        }
        if (SAFE_PS_DELETE_FLAGS.has(lower)) {
          continue;
        }
        if (SAFE_PS_VALUE_FLAGS.has(lower)) {
          continue;
        }
        if (val.startsWith("-")) {
          return { valid: false, reason: `Unsupported delete flag: ${val}` };
        }
      } else if (verb === "remove-item" || verb === "ri") {
        if (SAFE_PS_DELETE_FLAGS.has(lower) || SAFE_PS_VALUE_FLAGS.has(lower)) {
          continue;
        }
        if (val.startsWith("-")) {
          return { valid: false, reason: `Unsupported PowerShell delete flag: ${val}` };
        }
      } else {
        // del, erase, rd (CMD or PowerShell aliases)
        if (
          SAFE_CMD_DELETE_FLAGS.has(lower) ||
          SAFE_PS_DELETE_FLAGS.has(lower) ||
          SAFE_PS_VALUE_FLAGS.has(lower) ||
          /^-[frRviId]+$/.test(val)
        ) {
          continue;
        }
        if (val.startsWith("/") || val.startsWith("-")) {
          return { valid: false, reason: `Unsupported delete flag: ${val}` };
        }
      }
    }

    targets.push(val);
  }

  if (targets.length === 0) {
    return { valid: false, reason: "No target paths specified" };
  }

  return { valid: true, targets };
}

function detectGitDestructive(segment: ParsedSegment): string | undefined {
  if (segment.verbLower !== "git" || segment.args.length === 0) {
    return undefined;
  }

  // Skip global git flags like -C <dir> before subcommand
  let idx = 0;
  while (idx < segment.args.length) {
    const v = segment.args[idx].value;
    if (v === "-C" || v === "--git-dir" || v === "--work-tree" || v === "-c") {
      idx += 2;
      continue;
    }
    if (v.startsWith("-")) {
      idx += 1;
      continue;
    }
    break;
  }
  const sub = segment.args[idx]?.value.toLowerCase();
  const rest = segment.args.slice(idx + 1).map((t) => t.value);

  if (sub === "clean") {
    const isDryRun = rest.some((a) => a === "-n" || a === "--dry-run");
    const hasForce = rest.some(
      (a) => a === "--force" || (a.startsWith("-") && !a.startsWith("--") && a.includes("f"))
    );
    if (hasForce && !isDryRun) {
      return "git clean -f permanently deletes untracked files.";
    }
  }

  if (sub === "reset") {
    if (rest.some((a) => a === "--hard")) {
      return "git reset --hard permanently discards uncommitted working-tree changes.";
    }
  }

  if (sub === "checkout") {
    if (rest.includes("--") || rest.includes(".")) {
      return "git checkout -- / . permanently overwrites uncommitted local modifications.";
    }
  }

  if (sub === "restore") {
    const hasStaged = rest.some((a) => a === "--staged" || a === "-S");
    const hasWorktree = rest.some((a) => a === "--worktree" || a === "-W");
    const hasNonFlag = rest.some((a) => !a.startsWith("-"));
    if (hasNonFlag && (hasWorktree || !hasStaged)) {
      return "git restore without --staged permanently discards uncommitted working-tree modifications.";
    }
  }

  return undefined;
}

export function evaluateCommand(params: {
  commandLine: string;
  cwd: string;
  workspaceRoot: string;
  config: SibylConfig;
  runtimePath: string;
}): PolicyDecision {
  const { commandLine, cwd, workspaceRoot, config, runtimePath } = params;
  if (!commandLine || !commandLine.trim()) {
    return { action: "allow" };
  }

  const parsed = parseCommandLine(commandLine);
  if (parsed.segments.length === 0) {
    return { action: "allow" };
  }

  const protectedPaths = getProtectedPaths(workspaceRoot, config, runtimePath);

  // 1. Self-protection check across all segments
  if (commandTouchesProtectedPaths(parsed.segments, commandLine, cwd, protectedPaths, runtimePath)) {
    return {
      action: config.selfProtectPolicy,
      category: "self-protection",
      reason:
        "Sibyl protection: modifying or deleting the trash directory, .sibyl.json, hooks, or Sibyl runtime scripts is blocked.",
    };
  }

  // 2. Standalone Sibyl CLI invocation check
  if (!parsed.isCompound && !parsed.hasAnyRedirection && !parsed.hasAnySubshell && parsed.segments.length === 1) {
    const sibylCheck = isSibylInvocation(parsed.segments[0], runtimePath);
    if (sibylCheck.isSibyl) {
      if (sibylCheck.subcommand === "purge") {
        for (const arg of sibylCheck.args) {
          const val = arg.value.toLowerCase();
          if (PURGE_BYPASS_FLAGS.has(val) || val.startsWith("--id=")) {
            return {
              action: "deny",
              category: "purge-bypass",
              reason:
                "Agent purge cannot use --force, -f, --all, --ignore-cooldown, or --id. Run standard quota-gated `sibyl purge` instead (bypass flags are reserved for human terminals).",
            };
          }
        }
        if (config.purgePolicy === "autonomous") {
          return { action: "allow", category: "sibyl-purge" };
        }
        return {
          action: config.purgePolicy,
          category: "sibyl-purge",
          reason: "sibyl purge is gated by configured purgePolicy.",
        };
      }
      return { action: "allow", category: "sibyl-cli" };
    }
  }

  // 3. Simple standalone delete command -> allow if whitelisted, otherwise rewrite to sibyl trash
  if (
    !parsed.isCompound &&
    !parsed.hasAnyRedirection &&
    !parsed.hasAnySubshell &&
    parsed.segments.length === 1
  ) {
    const seg = parsed.segments[0];
    if (SIMPLE_DELETE_VERBS.has(seg.verbLower)) {
      const simple = parseSimpleDeleteTargets(seg);
      if (simple.valid) {
        const resolvedTargets = simple.targets.map((t) => path.resolve(cwd, t));
        for (const target of resolvedTargets) {
          for (const prot of protectedPaths) {
            if (isPathInside(target, prot) || isPathInside(prot, target)) {
              return {
                action: config.selfProtectPolicy,
                category: "self-protection",
                reason:
                  "Sibyl protection: refusing to delete protected Sibyl configuration, hooks, or trash directory.",
              };
            }
          }
        }

        const allWhitelisted = resolvedTargets.every((t) =>
          matchesDirectDeletePattern(t, workspaceRoot, config.allowDirectDeletePatterns)
        );
        if (allWhitelisted) {
          return { action: "allow", category: "whitelist-delete" };
        }

        const rewrittenCommand = buildTrashCommand(runtimePath, cwd, simple.targets);
        return {
          action: "rewrite",
          category: "rewrite-trash",
          rewrittenCommand,
          reason: `Rewritten native delete to Sibyl safe trash: ${rewrittenCommand}`,
        };
      }
    }
  }

  // 4. Complex / compound / indirect / inline script deletion check
  const rtForward = toForwardSlashes(runtimePath);
  for (const seg of parsed.segments) {
    if (SIMPLE_DELETE_VERBS.has(seg.verbLower) || COMPLEX_ONLY_DELETE_VERBS.has(seg.verbLower)) {
      return {
        action: "deny",
        category: "complex-delete",
        reason: `Blocked direct or compound deletion (${seg.verb}). Resolve concrete paths first and move them with: node "${rtForward}" trash -- <path1> <path2>`,
      };
    }

    if (seg.verbLower === "find") {
      const hasDeleteFlag = seg.args.some((a) => a.value === "-delete");
      const hasExecDelete =
        seg.args.some((a) => a.value === "-exec" || a.value === "-execdir") &&
        seg.args.some((a) => SIMPLE_DELETE_VERBS.has(a.value.toLowerCase()));
      if (hasDeleteFlag || hasExecDelete) {
        return {
          action: "deny",
          category: "find-delete",
          reason: `Blocked destructive find deletion. List matching paths first and pass explicit paths to: node "${rtForward}" trash -- <paths>`,
        };
      }
    }

    if (seg.verbLower === "xargs") {
      const hasDeleteArg = seg.args.some((a) => SIMPLE_DELETE_VERBS.has(a.value.toLowerCase()));
      if (hasDeleteArg) {
        return {
          action: "deny",
          category: "xargs-delete",
          reason: `Blocked xargs deletion. Pass explicit file paths to: node "${rtForward}" trash -- <paths>`,
        };
      }
    }

    const wrapped = unwrapShellWrapper(seg);
    if (wrapped.inlineCode) {
      if (INLINE_DESTRUCTIVE_REGEXES.some((re) => re.test(wrapped.inlineCode!))) {
        return {
          action: "deny",
          category: "inline-script-delete",
          reason: `Blocked inline script file deletion via ${wrapped.verbLower}. Do not delete files from inline scripts; move targets with: node "${rtForward}" trash -- <paths>`,
        };
      }
    }
  }

  // Also catch raw inline destructive calls when shell parser kept something in raw command
  if (
    parsed.segments.some((s) => INLINE_SCRIPT_RUNNERS.has(s.verbLower)) &&
    INLINE_DESTRUCTIVE_REGEXES.some((re) => re.test(commandLine))
  ) {
    return {
      action: "deny",
      category: "inline-script-delete",
      reason: `Blocked inline script deletion. Move files to Sibyl trash instead: node "${rtForward}" trash -- <paths>`,
    };
  }

  // 5. Destructive Git operations check
  for (const seg of parsed.segments) {
    const gitReason = detectGitDestructive(seg);
    if (gitReason) {
      if (config.gitDestructivePolicy === "allow") {
        return { action: "allow" };
      }
      return {
        action: config.gitDestructivePolicy,
        category: "git-destructive",
        reason: `${gitReason} Move untracked files with \`node "${rtForward}" trash -- <paths>\` or back up tracked edits with \`git stash push -u -m "sibyl-backup"\`.`,
      };
    }
  }

  return { action: "allow" };
}

export function evaluateFileWrite(params: {
  targetPath: string;
  cwd: string;
  workspaceRoot: string;
  config: SibylConfig;
  runtimePath: string;
}): PolicyDecision {
  const { targetPath, cwd, workspaceRoot, config, runtimePath } = params;
  if (!targetPath || !targetPath.trim()) {
    return { action: "allow" };
  }
  const resolved = path.resolve(cwd, targetPath);
  const protectedPaths = getProtectedPaths(workspaceRoot, config, runtimePath);
  for (const prot of protectedPaths) {
    if (isPathInside(resolved, prot)) {
      return {
        action: config.selfProtectPolicy,
        category: "self-protection",
        reason: `Sibyl protection: direct agent modification of protected path "${resolved}" is blocked.`,
      };
    }
  }
  return { action: "allow" };
}

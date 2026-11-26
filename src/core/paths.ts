import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSibylHome, type SibylConfig } from "./config.js";

export function expandHome(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

export function normalizeForCompare(p: string): string {
  const resolved = path.resolve(expandHome(p));
  const normalized = path.normalize(resolved);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function safeRealpath(p: string): string {
  const expanded = path.resolve(expandHome(p));
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(expanded) : fs.realpathSync(expanded);
  } catch {
    return expanded;
  }
}

export function isPathInside(child: string, parent: string): boolean {
  const normParent = normalizeForCompare(parent);
  const normChild = normalizeForCompare(child);
  const rel = path.relative(normParent, normChild);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function isFilesystemRoot(p: string): boolean {
  const resolved = path.resolve(expandHome(p));
  const parsed = path.parse(resolved);
  return normalizeForCompare(resolved) === normalizeForCompare(parsed.root);
}

const WORKSPACE_MARKERS = [".git", ".agents", ".claude", ".sibyl.json"];

export function resolveWorkspaceRoot(cwd: string, explicitWorkspace?: string): string {
  if (explicitWorkspace && explicitWorkspace.trim().length > 0) {
    return path.resolve(expandHome(explicitWorkspace));
  }
  const start = path.resolve(expandHome(cwd || process.cwd()));
  const homeNorm = normalizeForCompare(os.homedir());
  const startIsHome = normalizeForCompare(start) === homeNorm;
  let current = start;
  while (true) {
    // Do not treat the user's home directory (~/.claude, ~/.agents) as an implicit workspace for subpaths.
    if (!startIsHome && normalizeForCompare(current) === homeNorm) {
      break;
    }
    for (const marker of WORKSPACE_MARKERS) {
      if (fs.existsSync(path.join(current, marker))) {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return start;
}

export function getGlobalTrashRoot(): string {
  return path.join(getSibylHome(), "trash");
}

export function getWorkspaceTrashRoot(workspaceRoot: string, config: SibylConfig): string {
  return path.join(path.resolve(workspaceRoot), config.workspaceTrashDirName);
}

export function resolveTrashRoot(
  _targetPath: string,
  workspaceRoot: string,
  config: SibylConfig
): string {
  if (config.trashMode === "global") {
    return getGlobalTrashRoot();
  }
  if (config.trashMode === "custom" && config.customTrashDir) {
    return path.resolve(expandHome(config.customTrashDir));
  }
  return getWorkspaceTrashRoot(workspaceRoot, config);
}

export function getCandidateTrashRoots(workspaceRoot: string, config: SibylConfig): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => {
    const key = normalizeForCompare(p);
    if (!seen.has(key)) {
      seen.add(key);
      roots.push(path.resolve(p));
    }
  };

  if (config.trashMode === "workspace") {
    add(getWorkspaceTrashRoot(workspaceRoot, config));
    add(getGlobalTrashRoot());
  } else if (config.trashMode === "custom" && config.customTrashDir) {
    add(path.resolve(expandHome(config.customTrashDir)));
    add(getGlobalTrashRoot());
  } else {
    add(getGlobalTrashRoot());
    add(getWorkspaceTrashRoot(workspaceRoot, config));
  }
  return roots;
}

export function getProtectedPaths(
  workspaceRoot: string,
  config: SibylConfig,
  runtimePath?: string
): string[] {
  const resolvedWs = path.resolve(workspaceRoot);
  const sibylHome = getSibylHome();
  const home = os.homedir();
  const list = [
    getWorkspaceTrashRoot(resolvedWs, config),
    sibylHome,
    path.join(resolvedWs, ".sibyl.json"),
    path.join(sibylHome, "config.json"),
    path.join(resolvedWs, ".agents", "hooks.json"),
    path.join(resolvedWs, ".agents", "skills", "sibyl"),
    path.join(resolvedWs, ".claude", "settings.json"),
    path.join(resolvedWs, ".claude", "settings.local.json"),
    path.join(resolvedWs, ".claude", "skills", "sibyl"),
    path.join(home, ".gemini", "config", "hooks.json"),
    path.join(home, ".gemini", "config", "skills", "sibyl"),
    path.join(home, ".claude", "settings.json"),
    path.join(home, ".claude", "skills", "sibyl"),
  ];
  if (config.customTrashDir) {
    list.push(path.resolve(expandHome(config.customTrashDir)));
  }
  if (runtimePath) {
    list.push(path.resolve(runtimePath));
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of list) {
    const key = normalizeForCompare(item);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }
  return unique;
}

function globToRegExp(pattern: string): RegExp {
  const normalized = toForwardSlashes(pattern.trim());
  let regexStr = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === "*") {
      if (normalized[i + 1] === "*") {
        if (normalized[i + 2] === "/") {
          regexStr += "(?:.*/)?";
          i += 2;
        } else {
          regexStr += ".*";
          i += 1;
        }
      } else {
        regexStr += "[^/]*";
      }
    } else if (ch === "?") {
      regexStr += "[^/]";
    } else if (".+^${}()|[]\\".includes(ch)) {
      regexStr += `\\${ch}`;
    } else {
      regexStr += ch;
    }
  }
  regexStr += "$";
  return new RegExp(regexStr, process.platform === "win32" ? "i" : "");
}

export function matchesDirectDeletePattern(
  targetPath: string,
  workspaceRoot: string,
  patterns: string[]
): boolean {
  if (!patterns || patterns.length === 0) {
    return false;
  }
  if (!isPathInside(targetPath, workspaceRoot)) {
    return false;
  }
  const rel = toForwardSlashes(path.relative(path.resolve(workspaceRoot), path.resolve(targetPath)));
  if (!rel || rel === ".") {
    return false;
  }
  const base = path.posix.basename(rel);
  for (const pattern of patterns) {
    const cleaned = toForwardSlashes(pattern.trim()).replace(/\/+$/, "");
    if (!cleaned) {
      continue;
    }
    const re = globToRegExp(cleaned);
    if (cleaned.includes("/")) {
      if (re.test(rel)) {
        return true;
      }
    } else if (re.test(base) || re.test(rel)) {
      return true;
    }
  }
  return false;
}

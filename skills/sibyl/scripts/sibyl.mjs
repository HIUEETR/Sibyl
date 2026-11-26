#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/cli.ts
import fs7 from "node:fs";
import path9 from "node:path";
import { fileURLToPath } from "node:url";

// src/adapters/harness.ts
import path4 from "node:path";

// src/core/config.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var DEFAULT_CONFIG = {
  trashMode: "workspace",
  workspaceTrashDirName: ".sibyl-trash",
  maxBytes: 1024 * 1024 * 1024,
  // 1 GiB
  watermarkRatio: 0.5,
  // 50%
  coolDownHours: 24,
  allowDirectDeletePatterns: [],
  purgePolicy: "autonomous",
  gitDestructivePolicy: "deny",
  selfProtectPolicy: "deny"
};
var TRASH_MODES = /* @__PURE__ */ new Set(["workspace", "workspace-first", "global", "custom"]);
var PURGE_POLICIES = /* @__PURE__ */ new Set(["autonomous", "ask", "deny"]);
var GIT_POLICIES = /* @__PURE__ */ new Set(["deny", "ask", "allow"]);
var SELF_PROTECT_POLICIES = /* @__PURE__ */ new Set(["deny", "ask"]);
function getSibylHome() {
  const envHome = process.env.SIBYL_HOME?.trim();
  if (envHome) {
    return path.resolve(envHome);
  }
  return path.join(os.homedir(), ".sibyl");
}
__name(getSibylHome, "getSibylHome");
function readJsonObject(filePath) {
  if (!fs.existsSync(filePath)) {
    return void 0;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Malformed Sibyl config JSON at ${filePath}: ${err.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid Sibyl config at ${filePath}: expected a JSON object.`);
  }
  return parsed;
}
__name(readJsonObject, "readJsonObject");
function clampNumber(value, fallback, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  let v = Math.max(min, value);
  if (max !== void 0) {
    v = Math.min(max, v);
  }
  return v;
}
__name(clampNumber, "clampNumber");
function sanitizeDirName(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || trimmed.includes("/") || trimmed.includes("\\")) {
    return fallback;
  }
  return trimmed;
}
__name(sanitizeDirName, "sanitizeDirName");
function mergeConfigLayer(base, layer) {
  if (!layer) {
    return base;
  }
  const next = { ...base, allowDirectDeletePatterns: [...base.allowDirectDeletePatterns] };
  if (typeof layer.trashMode === "string" && TRASH_MODES.has(layer.trashMode)) {
    next.trashMode = layer.trashMode === "workspace-first" ? "workspace" : layer.trashMode;
  }
  if (typeof layer.customTrashDir === "string" && layer.customTrashDir.trim().length > 0) {
    next.customTrashDir = layer.customTrashDir.trim();
  }
  if (layer.workspaceTrashDirName !== void 0) {
    next.workspaceTrashDirName = sanitizeDirName(layer.workspaceTrashDirName, next.workspaceTrashDirName);
  }
  if (layer.maxBytes !== void 0) {
    next.maxBytes = Math.floor(clampNumber(layer.maxBytes, next.maxBytes, 1024));
  }
  if (layer.watermarkRatio !== void 0) {
    next.watermarkRatio = clampNumber(layer.watermarkRatio, next.watermarkRatio, 0.1, 0.95);
  }
  if (layer.coolDownHours !== void 0) {
    next.coolDownHours = clampNumber(layer.coolDownHours, next.coolDownHours, 0);
  }
  if (Array.isArray(layer.allowDirectDeletePatterns)) {
    next.allowDirectDeletePatterns = layer.allowDirectDeletePatterns.filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  }
  if (typeof layer.purgePolicy === "string" && PURGE_POLICIES.has(layer.purgePolicy)) {
    next.purgePolicy = layer.purgePolicy;
  }
  if (typeof layer.gitDestructivePolicy === "string" && GIT_POLICIES.has(layer.gitDestructivePolicy)) {
    next.gitDestructivePolicy = layer.gitDestructivePolicy;
  }
  if (typeof layer.selfProtectPolicy === "string" && SELF_PROTECT_POLICIES.has(layer.selfProtectPolicy)) {
    next.selfProtectPolicy = layer.selfProtectPolicy;
  }
  return next;
}
__name(mergeConfigLayer, "mergeConfigLayer");
function loadConfig(workspaceRoot) {
  const globalConfigPath = path.join(getSibylHome(), "config.json");
  const globalLayer = readJsonObject(globalConfigPath);
  let merged = mergeConfigLayer(DEFAULT_CONFIG, globalLayer);
  if (workspaceRoot) {
    const wsConfigPath = path.join(path.resolve(workspaceRoot), ".sibyl.json");
    const wsLayer = readJsonObject(wsConfigPath);
    merged = mergeConfigLayer(merged, wsLayer);
  }
  return merged;
}
__name(loadConfig, "loadConfig");

// src/core/paths.ts
import fs2 from "node:fs";
import os2 from "node:os";
import path2 from "node:path";
function expandHome(inputPath) {
  const trimmed = inputPath.trim();
  if (trimmed === "~") {
    return os2.homedir();
  }
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path2.join(os2.homedir(), trimmed.slice(2));
  }
  return trimmed;
}
__name(expandHome, "expandHome");
function toForwardSlashes(p) {
  return p.replace(/\\/g, "/");
}
__name(toForwardSlashes, "toForwardSlashes");
function normalizeForCompare(p) {
  const resolved = path2.resolve(expandHome(p));
  const normalized = path2.normalize(resolved);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
__name(normalizeForCompare, "normalizeForCompare");
function isPathInside(child, parent) {
  const normParent = normalizeForCompare(parent);
  const normChild = normalizeForCompare(child);
  const rel = path2.relative(normParent, normChild);
  return rel === "" || !rel.startsWith("..") && !path2.isAbsolute(rel);
}
__name(isPathInside, "isPathInside");
function isFilesystemRoot(p) {
  const resolved = path2.resolve(expandHome(p));
  const parsed = path2.parse(resolved);
  return normalizeForCompare(resolved) === normalizeForCompare(parsed.root);
}
__name(isFilesystemRoot, "isFilesystemRoot");
var WORKSPACE_MARKERS = [".git", ".agents", ".claude", ".sibyl.json"];
function resolveWorkspaceRoot(cwd, explicitWorkspace) {
  if (explicitWorkspace && explicitWorkspace.trim().length > 0) {
    return path2.resolve(expandHome(explicitWorkspace));
  }
  const start = path2.resolve(expandHome(cwd || process.cwd()));
  const homeNorm = normalizeForCompare(os2.homedir());
  const startIsHome = normalizeForCompare(start) === homeNorm;
  let current = start;
  while (true) {
    if (!startIsHome && normalizeForCompare(current) === homeNorm) {
      break;
    }
    for (const marker of WORKSPACE_MARKERS) {
      if (fs2.existsSync(path2.join(current, marker))) {
        return current;
      }
    }
    const parent = path2.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return start;
}
__name(resolveWorkspaceRoot, "resolveWorkspaceRoot");
function getGlobalTrashRoot() {
  return path2.join(getSibylHome(), "trash");
}
__name(getGlobalTrashRoot, "getGlobalTrashRoot");
function getWorkspaceTrashRoot(workspaceRoot, config) {
  return path2.join(path2.resolve(workspaceRoot), config.workspaceTrashDirName);
}
__name(getWorkspaceTrashRoot, "getWorkspaceTrashRoot");
function resolveTrashRoot(_targetPath, workspaceRoot, config) {
  if (config.trashMode === "global") {
    return getGlobalTrashRoot();
  }
  if (config.trashMode === "custom" && config.customTrashDir) {
    return path2.resolve(expandHome(config.customTrashDir));
  }
  return getWorkspaceTrashRoot(workspaceRoot, config);
}
__name(resolveTrashRoot, "resolveTrashRoot");
function getCandidateTrashRoots(workspaceRoot, config) {
  const roots = [];
  const seen = /* @__PURE__ */ new Set();
  const add = /* @__PURE__ */ __name((p) => {
    const key = normalizeForCompare(p);
    if (!seen.has(key)) {
      seen.add(key);
      roots.push(path2.resolve(p));
    }
  }, "add");
  if (config.trashMode === "workspace") {
    add(getWorkspaceTrashRoot(workspaceRoot, config));
    add(getGlobalTrashRoot());
  } else if (config.trashMode === "custom" && config.customTrashDir) {
    add(path2.resolve(expandHome(config.customTrashDir)));
    add(getGlobalTrashRoot());
  } else {
    add(getGlobalTrashRoot());
    add(getWorkspaceTrashRoot(workspaceRoot, config));
  }
  return roots;
}
__name(getCandidateTrashRoots, "getCandidateTrashRoots");
function getProtectedPaths(workspaceRoot, config, runtimePath) {
  const resolvedWs = path2.resolve(workspaceRoot);
  const sibylHome = getSibylHome();
  const home = os2.homedir();
  const list = [
    getWorkspaceTrashRoot(resolvedWs, config),
    sibylHome,
    path2.join(resolvedWs, ".sibyl.json"),
    path2.join(sibylHome, "config.json"),
    path2.join(resolvedWs, ".agents", "hooks.json"),
    path2.join(resolvedWs, ".agents", "skills", "sibyl"),
    path2.join(resolvedWs, ".claude", "settings.json"),
    path2.join(resolvedWs, ".claude", "settings.local.json"),
    path2.join(resolvedWs, ".claude", "skills", "sibyl"),
    path2.join(home, ".gemini", "config", "hooks.json"),
    path2.join(home, ".gemini", "config", "skills", "sibyl"),
    path2.join(home, ".claude", "settings.json"),
    path2.join(home, ".claude", "skills", "sibyl")
  ];
  if (config.customTrashDir) {
    list.push(path2.resolve(expandHome(config.customTrashDir)));
  }
  if (runtimePath) {
    list.push(path2.resolve(runtimePath));
  }
  const seen = /* @__PURE__ */ new Set();
  const unique = [];
  for (const item of list) {
    const key = normalizeForCompare(item);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }
  return unique;
}
__name(getProtectedPaths, "getProtectedPaths");
function globToRegExp(pattern) {
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
__name(globToRegExp, "globToRegExp");
function matchesDirectDeletePattern(targetPath, workspaceRoot, patterns) {
  if (!patterns || patterns.length === 0) {
    return false;
  }
  if (!isPathInside(targetPath, workspaceRoot)) {
    return false;
  }
  const rel = toForwardSlashes(path2.relative(path2.resolve(workspaceRoot), path2.resolve(targetPath)));
  if (!rel || rel === ".") {
    return false;
  }
  const base = path2.posix.basename(rel);
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
__name(matchesDirectDeletePattern, "matchesDirectDeletePattern");

// src/policy/analyzer.ts
import path3 from "node:path";

// src/policy/shell-parser.ts
var COMPOUND_OPS = /* @__PURE__ */ new Set(["&&", "||", ";", "|", "&", "\n"]);
var REDIRECT_OPS = /* @__PURE__ */ new Set([">", ">>", "<", "<<", "2>", "2>>", "&>", "1>", "1>>"]);
function lexCommandLine(input) {
  const items = [];
  let i = 0;
  const len = input.length;
  const pushWord = /* @__PURE__ */ __name((value, raw, quote, hasExpansion, hasGlob, hasSubshell) => {
    items.push({ kind: "word", value, raw, quote, hasExpansion, hasGlob, hasSubshell });
  }, "pushWord");
  while (i < len) {
    const ch = input[i];
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      items.push({
        kind: "op",
        value: "\n",
        raw: "\n",
        quote: "none",
        hasExpansion: false,
        hasGlob: false,
        hasSubshell: false
      });
      i += 1;
      continue;
    }
    if (ch === " " || ch === "	") {
      i += 1;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (two === "&&" || two === "||" || two === ">>" || two === "<<" || two === "2>" || two === "&>" || two === "1>") {
      if ((two === "2>" || two === "1>") && input[i + 2] === ">") {
        const three = input.slice(i, i + 3);
        items.push({ kind: "op", value: three, raw: three, quote: "none", hasExpansion: false, hasGlob: false, hasSubshell: false });
        i += 3;
        continue;
      }
      items.push({ kind: "op", value: two, raw: two, quote: "none", hasExpansion: false, hasGlob: false, hasSubshell: false });
      i += 2;
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "&" || ch === ">" || ch === "<") {
      items.push({ kind: "op", value: ch, raw: ch, quote: "none", hasExpansion: false, hasGlob: false, hasSubshell: false });
      i += 1;
      continue;
    }
    let value = "";
    const startIdx = i;
    let firstQuote = "none";
    let hasExpansion = false;
    let hasGlob = false;
    let hasSubshell = false;
    while (i < len) {
      const c = input[i];
      if (c === " " || c === "	" || c === "\r" || c === "\n" || c === ";" || c === "|" || c === "&" || c === ">" || c === "<") {
        break;
      }
      if (c === "'") {
        if (firstQuote === "none") firstQuote = "single";
        i += 1;
        while (i < len && input[i] !== "'") {
          if (input[i] === "%") {
            const nextPct = input.indexOf("%", i + 1);
            if (nextPct > i + 1 && !/\s/.test(input.slice(i + 1, nextPct))) {
              hasExpansion = true;
            }
          }
          value += input[i];
          i += 1;
        }
        if (i < len && input[i] === "'") {
          i += 1;
        }
        continue;
      }
      if (c === '"') {
        if (firstQuote === "none") firstQuote = "double";
        i += 1;
        while (i < len && input[i] !== '"') {
          const dc = input[i];
          if (dc === "\\" && i + 1 < len && (input[i + 1] === '"' || input[i + 1] === "\\" || input[i + 1] === "$")) {
            value += input[i + 1];
            i += 2;
            continue;
          }
          if (dc === "`" && i + 1 < len) {
            if (input[i + 1] === '"' || input[i + 1] === "`" || input[i + 1] === "$") {
              value += input[i + 1];
              i += 2;
              continue;
            }
            hasSubshell = true;
          }
          if (dc === "$") {
            if (input[i + 1] === "(") {
              hasSubshell = true;
            }
            if (i + 1 < len && /[A-Za-z0-9_{(*?@#!]/.test(input[i + 1])) {
              hasExpansion = true;
            }
          }
          if (dc === "%") {
            const nextPct = input.indexOf("%", i + 1);
            if (nextPct > i + 1 && !/\s/.test(input.slice(i + 1, nextPct))) {
              hasExpansion = true;
            }
          }
          value += dc;
          i += 1;
        }
        if (i < len && input[i] === '"') {
          i += 1;
        }
        continue;
      }
      if (c === "\\" && i + 1 < len) {
        const next = input[i + 1];
        if (next === " " || next === '"' || next === "'" || next === "$" || next === "`" || next === "&" || next === "|") {
          value += next;
          i += 2;
          continue;
        }
      }
      if (c === "(" || c === ")") {
        hasSubshell = true;
      }
      if (c === "`") {
        hasSubshell = true;
      }
      if (c === "$") {
        if (input[i + 1] === "(") {
          hasSubshell = true;
        }
        if (i + 1 < len && /[A-Za-z0-9_{(*?@#!]/.test(input[i + 1])) {
          hasExpansion = true;
        }
      }
      if (c === "%") {
        const nextPct = input.indexOf("%", i + 1);
        if (nextPct > i + 1 && !/\s/.test(input.slice(i + 1, nextPct))) {
          hasExpansion = true;
        }
      }
      if (c === "*" || c === "?" || c === "[") {
        hasGlob = true;
      }
      value += c;
      i += 1;
    }
    pushWord(value, input.slice(startIdx, i), firstQuote, hasExpansion, hasGlob, hasSubshell);
  }
  return items;
}
__name(lexCommandLine, "lexCommandLine");
function normalizeVerb(rawVerb) {
  if (!rawVerb) {
    return "";
  }
  const forward = rawVerb.replace(/\\/g, "/");
  const idx = forward.lastIndexOf("/");
  const base = idx >= 0 ? forward.slice(idx + 1) : forward;
  return base.replace(/\.exe$/i, "");
}
__name(normalizeVerb, "normalizeVerb");
function buildSegment(rawItems, hasLineBreak) {
  const tokens = [];
  let hasRedirection = false;
  let hasSubshell = false;
  for (const item of rawItems) {
    if (item.kind === "op") {
      if (REDIRECT_OPS.has(item.value)) {
        hasRedirection = true;
      }
      continue;
    }
    if (item.hasSubshell) {
      hasSubshell = true;
    }
    tokens.push({
      value: item.value,
      raw: item.raw,
      quote: item.quote,
      hasExpansion: item.hasExpansion,
      hasGlob: item.hasGlob
    });
  }
  const verb = tokens.length > 0 ? normalizeVerb(tokens[0].value) : "";
  return {
    raw: rawItems.map((it) => it.raw).join(" "),
    tokens,
    verb,
    verbLower: verb.toLowerCase(),
    args: tokens.slice(1),
    hasRedirection,
    hasSubshell,
    hasLineBreak
  };
}
__name(buildSegment, "buildSegment");
function parseCommandLine(input) {
  const items = lexCommandLine(input);
  const segments = [];
  let current = [];
  let isCompound = false;
  let hasLineBreak = false;
  for (const item of items) {
    if (item.kind === "op" && COMPOUND_OPS.has(item.value)) {
      if (item.value === "\n") {
        hasLineBreak = true;
      }
      if (current.length > 0) {
        segments.push(buildSegment(current, hasLineBreak));
        current = [];
      }
      isCompound = true;
      continue;
    }
    current.push(item);
  }
  if (current.length > 0) {
    segments.push(buildSegment(current, hasLineBreak));
  }
  if (segments.length > 1) {
    isCompound = true;
  }
  return {
    raw: input,
    segments,
    isCompound,
    hasAnyRedirection: segments.some((s) => s.hasRedirection),
    hasAnySubshell: segments.some((s) => s.hasSubshell),
    hasAnyExpansion: segments.some((s) => s.tokens.some((t) => t.hasExpansion)),
    hasAnyGlob: segments.some((s) => s.tokens.some((t) => t.hasGlob))
  };
}
__name(parseCommandLine, "parseCommandLine");

// src/policy/analyzer.ts
var SIMPLE_DELETE_VERBS = /* @__PURE__ */ new Set([
  "rm",
  "rmdir",
  "unlink",
  "del",
  "erase",
  "rd",
  "remove-item",
  "ri"
]);
var COMPLEX_ONLY_DELETE_VERBS = /* @__PURE__ */ new Set([
  "shred",
  "rimraf",
  "srm",
  "clear-recyclebin",
  "trash-empty"
]);
var INLINE_SCRIPT_RUNNERS = /* @__PURE__ */ new Set([
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
  "zsh"
]);
var INLINE_DESTRUCTIVE_REGEXES = [
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
  /(?:^|[;&|]\s*)(rm|del|erase|rd|rmdir|Remove-Item)\b/i
];
var MUTATING_VERBS = /* @__PURE__ */ new Set([
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
  "git"
]);
var SAFE_POSIX_DELETE_FLAGS = /* @__PURE__ */ new Set([
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
  "--interactive"
]);
var SAFE_PS_DELETE_FLAGS = /* @__PURE__ */ new Set([
  "-recurse",
  "-force",
  "-verbose",
  "-confirm:$false",
  "-confirm"
]);
var SAFE_PS_VALUE_FLAGS = /* @__PURE__ */ new Set(["-path", "-literalpath"]);
var SAFE_CMD_DELETE_FLAGS = /* @__PURE__ */ new Set(["/f", "/s", "/q", "/p"]);
var PURGE_BYPASS_FLAGS = /* @__PURE__ */ new Set(["--force", "-f", "--all", "--ignore-cooldown", "--id"]);
function quoteShellArg(arg) {
  const escaped = arg.replace(/"/g, '\\"');
  return `"${escaped}"`;
}
__name(quoteShellArg, "quoteShellArg");
function buildTrashCommand(runtimePath, cwd, targets) {
  const rt = toForwardSlashes(runtimePath);
  const normCwd = toForwardSlashes(cwd);
  const quotedTargets = targets.map((t) => quoteShellArg(t)).join(" ");
  return `node ${quoteShellArg(rt)} trash --from-hook --cwd ${quoteShellArg(normCwd)} -- ${quotedTargets}`;
}
__name(buildTrashCommand, "buildTrashCommand");
function isSibylInvocation(segment, runtimePath) {
  const v = segment.verbLower;
  if (v === "sibyl") {
    const sub = segment.args[0]?.value.toLowerCase() ?? "";
    return { isSibyl: true, subcommand: sub, args: segment.args.slice(1) };
  }
  if ((v === "node" || v === "bun") && segment.args.length >= 1) {
    const scriptArg = segment.args[0].value;
    const base = path3.posix.basename(toForwardSlashes(scriptArg)).toLowerCase();
    if (base === "sibyl.mjs" || normalizeForCompare(path3.resolve(scriptArg)) === normalizeForCompare(runtimePath)) {
      const sub = segment.args[1]?.value.toLowerCase() ?? "";
      return { isSibyl: true, subcommand: sub, args: segment.args.slice(2) };
    }
  }
  return { isSibyl: false };
}
__name(isSibylInvocation, "isSibylInvocation");
function unwrapShellWrapper(segment) {
  const v = segment.verbLower;
  if (!INLINE_SCRIPT_RUNNERS.has(v)) {
    return { verbLower: v };
  }
  for (let i = 0; i < segment.args.length; i += 1) {
    const a = segment.args[i].value.toLowerCase();
    if (a === "-c" || a === "-e" || a === "/c" || a === "-command" || a === "-encodedcommand") {
      return {
        verbLower: v,
        inlineCode: segment.args.slice(i + 1).map((t) => t.value).join(" ")
      };
    }
  }
  return { verbLower: v };
}
__name(unwrapShellWrapper, "unwrapShellWrapper");
function tokenReferencesProtectedPath(tokenValue, cwd, protectedPaths) {
  if (!tokenValue || tokenValue.startsWith("-")) {
    return false;
  }
  const trimmed = tokenValue.trim();
  if (!trimmed) {
    return false;
  }
  const resolved = path3.resolve(cwd, trimmed);
  for (const prot of protectedPaths) {
    if (isPathInside(resolved, prot) || isPathInside(prot, resolved)) {
      return true;
    }
  }
  const normToken = toForwardSlashes(trimmed).toLowerCase();
  for (const prot of protectedPaths) {
    const normProt = toForwardSlashes(prot).toLowerCase();
    const protBase = path3.posix.basename(normProt);
    if (normToken.includes(normProt)) {
      return true;
    }
    if ((protBase === ".sibyl-trash" || protBase === ".sibyl.json" || protBase === "sibyl.mjs" || protBase === "hooks.json") && normToken.includes(protBase)) {
      return true;
    }
  }
  return false;
}
__name(tokenReferencesProtectedPath, "tokenReferencesProtectedPath");
function commandTouchesProtectedPaths(segments, rawCommand, cwd, protectedPaths, runtimePath) {
  const lowerRaw = rawCommand.toLowerCase();
  const hasMutationHint = segments.some(
    (seg) => MUTATING_VERBS.has(seg.verbLower) || seg.hasRedirection || INLINE_SCRIPT_RUNNERS.has(seg.verbLower)
  ) || />/.test(rawCommand);
  if (!hasMutationHint) {
    return false;
  }
  for (const seg of segments) {
    if (!seg.hasRedirection && segments.length === 1) {
      const sibylCheck = isSibylInvocation(seg, runtimePath);
      if (sibylCheck.isSibyl) {
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
  for (const prot of protectedPaths) {
    const base = path3.basename(prot).toLowerCase();
    const normProt = toForwardSlashes(prot).toLowerCase();
    if ((lowerRaw.includes(normProt) || base !== "sibyl" && (base === ".sibyl-trash" || base === ".sibyl.json" || base === "sibyl.mjs" || base === "hooks.json" || base === "settings.json" || base === "settings.local.json") && lowerRaw.includes(base)) && (/>/.test(rawCommand) || segments.some(
      (s) => MUTATING_VERBS.has(s.verbLower) || INLINE_SCRIPT_RUNNERS.has(s.verbLower)
    ))) {
      return true;
    }
  }
  return false;
}
__name(commandTouchesProtectedPaths, "commandTouchesProtectedPaths");
function parseSimpleDeleteTargets(segment) {
  const verb = segment.verbLower;
  if (!SIMPLE_DELETE_VERBS.has(verb)) {
    return { valid: false, reason: "Not a simple delete verb" };
  }
  const targets = [];
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
        if (SAFE_CMD_DELETE_FLAGS.has(lower) || SAFE_PS_DELETE_FLAGS.has(lower) || SAFE_PS_VALUE_FLAGS.has(lower) || /^-[frRviId]+$/.test(val)) {
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
__name(parseSimpleDeleteTargets, "parseSimpleDeleteTargets");
function detectGitDestructive(segment) {
  if (segment.verbLower !== "git" || segment.args.length === 0) {
    return void 0;
  }
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
      (a) => a === "--force" || a.startsWith("-") && !a.startsWith("--") && a.includes("f")
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
  return void 0;
}
__name(detectGitDestructive, "detectGitDestructive");
function evaluateCommand(params) {
  const { commandLine, cwd, workspaceRoot, config, runtimePath } = params;
  if (!commandLine || !commandLine.trim()) {
    return { action: "allow" };
  }
  const parsed = parseCommandLine(commandLine);
  if (parsed.segments.length === 0) {
    return { action: "allow" };
  }
  const protectedPaths = getProtectedPaths(workspaceRoot, config, runtimePath);
  if (commandTouchesProtectedPaths(parsed.segments, commandLine, cwd, protectedPaths, runtimePath)) {
    return {
      action: config.selfProtectPolicy,
      category: "self-protection",
      reason: "Sibyl protection: modifying or deleting the trash directory, .sibyl.json, hooks, or Sibyl runtime scripts is blocked."
    };
  }
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
              reason: "Agent purge cannot use --force, -f, --all, --ignore-cooldown, or --id. Run standard quota-gated `sibyl purge` instead (bypass flags are reserved for human terminals)."
            };
          }
        }
        if (config.purgePolicy === "autonomous") {
          return { action: "allow", category: "sibyl-purge" };
        }
        return {
          action: config.purgePolicy,
          category: "sibyl-purge",
          reason: "sibyl purge is gated by configured purgePolicy."
        };
      }
      return { action: "allow", category: "sibyl-cli" };
    }
  }
  if (!parsed.isCompound && !parsed.hasAnyRedirection && !parsed.hasAnySubshell && parsed.segments.length === 1) {
    const seg = parsed.segments[0];
    if (SIMPLE_DELETE_VERBS.has(seg.verbLower)) {
      const simple = parseSimpleDeleteTargets(seg);
      if (simple.valid) {
        const resolvedTargets = simple.targets.map((t) => path3.resolve(cwd, t));
        for (const target of resolvedTargets) {
          for (const prot of protectedPaths) {
            if (isPathInside(target, prot) || isPathInside(prot, target)) {
              return {
                action: config.selfProtectPolicy,
                category: "self-protection",
                reason: "Sibyl protection: refusing to delete protected Sibyl configuration, hooks, or trash directory."
              };
            }
          }
        }
        const allWhitelisted = resolvedTargets.every(
          (t) => matchesDirectDeletePattern(t, workspaceRoot, config.allowDirectDeletePatterns)
        );
        if (allWhitelisted) {
          return { action: "allow", category: "whitelist-delete" };
        }
        const rewrittenCommand = buildTrashCommand(runtimePath, cwd, simple.targets);
        return {
          action: "rewrite",
          category: "rewrite-trash",
          rewrittenCommand,
          reason: `Rewritten native delete to Sibyl safe trash: ${rewrittenCommand}`
        };
      }
    }
  }
  const rtForward = toForwardSlashes(runtimePath);
  for (const seg of parsed.segments) {
    if (SIMPLE_DELETE_VERBS.has(seg.verbLower) || COMPLEX_ONLY_DELETE_VERBS.has(seg.verbLower)) {
      return {
        action: "deny",
        category: "complex-delete",
        reason: `Blocked direct or compound deletion (${seg.verb}). Resolve concrete paths first and move them with: node "${rtForward}" trash -- <path1> <path2>`
      };
    }
    if (seg.verbLower === "find") {
      const hasDeleteFlag = seg.args.some((a) => a.value === "-delete");
      const hasExecDelete = seg.args.some((a) => a.value === "-exec" || a.value === "-execdir") && seg.args.some((a) => SIMPLE_DELETE_VERBS.has(a.value.toLowerCase()));
      if (hasDeleteFlag || hasExecDelete) {
        return {
          action: "deny",
          category: "find-delete",
          reason: `Blocked destructive find deletion. List matching paths first and pass explicit paths to: node "${rtForward}" trash -- <paths>`
        };
      }
    }
    if (seg.verbLower === "xargs") {
      const hasDeleteArg = seg.args.some((a) => SIMPLE_DELETE_VERBS.has(a.value.toLowerCase()));
      if (hasDeleteArg) {
        return {
          action: "deny",
          category: "xargs-delete",
          reason: `Blocked xargs deletion. Pass explicit file paths to: node "${rtForward}" trash -- <paths>`
        };
      }
    }
    const wrapped = unwrapShellWrapper(seg);
    if (wrapped.inlineCode) {
      if (INLINE_DESTRUCTIVE_REGEXES.some((re) => re.test(wrapped.inlineCode))) {
        return {
          action: "deny",
          category: "inline-script-delete",
          reason: `Blocked inline script file deletion via ${wrapped.verbLower}. Do not delete files from inline scripts; move targets with: node "${rtForward}" trash -- <paths>`
        };
      }
    }
  }
  if (parsed.segments.some((s) => INLINE_SCRIPT_RUNNERS.has(s.verbLower)) && INLINE_DESTRUCTIVE_REGEXES.some((re) => re.test(commandLine))) {
    return {
      action: "deny",
      category: "inline-script-delete",
      reason: `Blocked inline script deletion. Move files to Sibyl trash instead: node "${rtForward}" trash -- <paths>`
    };
  }
  for (const seg of parsed.segments) {
    const gitReason = detectGitDestructive(seg);
    if (gitReason) {
      if (config.gitDestructivePolicy === "allow") {
        return { action: "allow" };
      }
      return {
        action: config.gitDestructivePolicy,
        category: "git-destructive",
        reason: `${gitReason} Move untracked files with \`node "${rtForward}" trash -- <paths>\` or back up tracked edits with \`git stash push -u -m "sibyl-backup"\`.`
      };
    }
  }
  return { action: "allow" };
}
__name(evaluateCommand, "evaluateCommand");
function evaluateFileWrite(params) {
  const { targetPath, cwd, workspaceRoot, config, runtimePath } = params;
  if (!targetPath || !targetPath.trim()) {
    return { action: "allow" };
  }
  const resolved = path3.resolve(cwd, targetPath);
  const protectedPaths = getProtectedPaths(workspaceRoot, config, runtimePath);
  for (const prot of protectedPaths) {
    if (isPathInside(resolved, prot)) {
      return {
        action: config.selfProtectPolicy,
        category: "self-protection",
        reason: `Sibyl protection: direct agent modification of protected path "${resolved}" is blocked.`
      };
    }
  }
  return { action: "allow" };
}
__name(evaluateFileWrite, "evaluateFileWrite");

// src/adapters/harness.ts
function detectHarness(payload, explicit) {
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
__name(detectHarness, "detectHarness");
function extractCwd(payload, fallbackCwd) {
  if (typeof payload.cwd === "string" && payload.cwd.trim()) {
    return payload.cwd;
  }
  if (Array.isArray(payload.workspacePaths) && typeof payload.workspacePaths[0] === "string") {
    return payload.workspacePaths[0];
  }
  return fallbackCwd;
}
__name(extractCwd, "extractCwd");
function extractExplicitWorkspace(payload) {
  if (Array.isArray(payload.workspacePaths) && typeof payload.workspacePaths[0] === "string") {
    return payload.workspacePaths[0];
  }
  return void 0;
}
__name(extractExplicitWorkspace, "extractExplicitWorkspace");
function buildSessionStartMessage(runtimePath) {
  const rt = toForwardSlashes(runtimePath);
  return `Sibyl safe-deletion guard is active. Never delete files directly with rm/del/Remove-Item or inline scripts. Move unwanted files to trash using \`node "${rt}" trash -- <paths>\` (or the sibyl_trash MCP tool). Use \`status\`, \`list\`, \`restore <id>\`, and quota-gated \`purge\` (1 GiB limit, 24h cool-down, 50% FIFO watermark) when managing trash.`;
}
__name(buildSessionStartMessage, "buildSessionStartMessage");
function mapDecisionToHarness(decision, harness, eventName) {
  if (harness === "antigravity") {
    if (decision.action === "allow") {
      return { decision: "allow" };
    }
    if (decision.action === "rewrite" && decision.rewrittenCommand) {
      return {
        decision: "allow",
        reason: decision.reason,
        overwrite: {
          CommandLine: decision.rewrittenCommand
        }
      };
    }
    if (decision.action === "ask") {
      return {
        decision: "force_ask",
        reason: decision.reason ?? "Requires confirmation."
      };
    }
    return {
      decision: "deny",
      reason: decision.reason ?? "Blocked by Sibyl safe-deletion guard."
    };
  }
  if (harness === "claude") {
    const hookEventName = eventName || "PreToolUse";
    if (decision.action === "allow") {
      return {
        hookSpecificOutput: {
          hookEventName,
          permissionDecision: "allow"
        }
      };
    }
    if (decision.action === "rewrite" && decision.rewrittenCommand) {
      return {
        hookSpecificOutput: {
          hookEventName,
          permissionDecision: "allow",
          permissionDecisionReason: decision.reason,
          updatedInput: {
            command: decision.rewrittenCommand
          }
        }
      };
    }
    if (decision.action === "ask") {
      return {
        hookSpecificOutput: {
          hookEventName,
          permissionDecision: "ask",
          permissionDecisionReason: decision.reason ?? "Requires confirmation."
        }
      };
    }
    return {
      hookSpecificOutput: {
        hookEventName,
        permissionDecision: "deny",
        permissionDecisionReason: decision.reason ?? "Blocked by Sibyl safe-deletion guard."
      }
    };
  }
  if (decision.action === "allow") {
    return { decision: "allow" };
  }
  if (decision.action === "rewrite") {
    return {
      decision: "deny",
      reason: decision.reason ?? `Blocked native deletion. Run this instead: ${decision.rewrittenCommand ?? ""}`
    };
  }
  if (decision.action === "ask") {
    return { decision: "ask", reason: decision.reason };
  }
  return {
    decision: "deny",
    reason: decision.reason ?? "Blocked by Sibyl safe-deletion guard."
  };
}
__name(mapDecisionToHarness, "mapDecisionToHarness");
function handleHookPayload(payload, options) {
  const harness = detectHarness(payload, options.explicitHarness);
  const fallbackCwd = options.fallbackCwd ?? process.cwd();
  const cwd = extractCwd(payload, fallbackCwd);
  const workspaceRoot = resolveWorkspaceRoot(cwd, extractExplicitWorkspace(payload));
  const config = loadConfig(workspaceRoot);
  const runtimePath = path4.resolve(options.runtimePath);
  const eventName = typeof payload.hookEventName === "string" ? payload.hookEventName : typeof payload.hook_event_name === "string" ? payload.hook_event_name : "PreToolUse";
  if (eventName === "SessionStart") {
    const msg = buildSessionStartMessage(runtimePath);
    if (harness === "antigravity") {
      return {
        injectSteps: [
          {
            systemMessage: {
              systemMessage: msg
            }
          }
        ]
      };
    }
    if (harness === "claude") {
      return {
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: msg
        }
      };
    }
    return { decision: "allow", message: msg };
  }
  if (eventName !== "PreToolUse") {
    return {};
  }
  let toolName = "";
  let toolArgs = {};
  if (payload.toolCall && typeof payload.toolCall === "object") {
    const tc = payload.toolCall;
    if (typeof tc.name === "string") toolName = tc.name;
    if (tc.args && typeof tc.args === "object") toolArgs = tc.args;
  } else {
    if (typeof payload.tool_name === "string") toolName = payload.tool_name;
    if (payload.tool_input && typeof payload.tool_input === "object") {
      toolArgs = payload.tool_input;
    }
  }
  const normalizedTool = toolName.toLowerCase();
  if (normalizedTool === "run_command" || normalizedTool === "bash") {
    const cmd = typeof toolArgs.CommandLine === "string" ? toolArgs.CommandLine : typeof toolArgs.command === "string" ? toolArgs.command : "";
    const decision = evaluateCommand({
      commandLine: cmd,
      cwd,
      workspaceRoot,
      config,
      runtimePath
    });
    return mapDecisionToHarness(decision, harness, eventName);
  }
  if (normalizedTool === "write_file" || normalizedTool === "edit_file" || normalizedTool === "write" || normalizedTool === "edit" || normalizedTool === "multiedit") {
    const targetPath = typeof toolArgs.Path === "string" ? toolArgs.Path : typeof toolArgs.file_path === "string" ? toolArgs.file_path : typeof toolArgs.path === "string" ? toolArgs.path : "";
    const decision = evaluateFileWrite({
      targetPath,
      cwd,
      workspaceRoot,
      config,
      runtimePath
    });
    return mapDecisionToHarness(decision, harness, eventName);
  }
  return mapDecisionToHarness({ action: "allow" }, harness, eventName);
}
__name(handleHookPayload, "handleHookPayload");

// src/core/trash-service.ts
import fs5 from "node:fs";
import path7 from "node:path";

// src/core/fs-ops.ts
import fs3 from "node:fs";
import path5 from "node:path";
function detectEntryType(stats) {
  if (stats.isSymbolicLink()) {
    return "symlink";
  }
  if (stats.isDirectory()) {
    return "dir";
  }
  return "file";
}
__name(detectEntryType, "detectEntryType");
async function calculateSize(targetPath) {
  const st = await fs3.promises.lstat(targetPath);
  if (st.isSymbolicLink()) {
    return st.size;
  }
  if (!st.isDirectory()) {
    return st.size;
  }
  let total = 0;
  const entries = await fs3.promises.readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    total += await calculateSize(path5.join(targetPath, entry.name));
  }
  return total;
}
__name(calculateSize, "calculateSize");
async function clearReadOnlyRecursive(targetPath) {
  if (process.platform !== "win32") {
    return;
  }
  const st = await fs3.promises.lstat(targetPath);
  if (st.isSymbolicLink()) {
    return;
  }
  try {
    await fs3.promises.chmod(targetPath, st.mode | 128);
  } catch {
  }
  if (st.isDirectory()) {
    const entries = await fs3.promises.readdir(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      await clearReadOnlyRecursive(path5.join(targetPath, entry.name));
    }
  }
}
__name(clearReadOnlyRecursive, "clearReadOnlyRecursive");
async function copySymlinkSafe(srcPath, destPath) {
  const linkTarget = await fs3.promises.readlink(srcPath);
  try {
    await fs3.promises.symlink(linkTarget, destPath);
  } catch (err) {
    const code = err.code;
    if (process.platform === "win32" && (code === "EPERM" || code === "EISDIR")) {
      const resolvedTarget = path5.resolve(path5.dirname(srcPath), linkTarget);
      await fs3.promises.symlink(resolvedTarget, destPath, "junction");
      return;
    }
    throw err;
  }
}
__name(copySymlinkSafe, "copySymlinkSafe");
async function copyTreeSafe(srcDir, destDir) {
  await fs3.promises.mkdir(destDir, { recursive: true });
  let count = 1;
  const entries = await fs3.promises.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcChild = path5.join(srcDir, entry.name);
    const destChild = path5.join(destDir, entry.name);
    const st = await fs3.promises.lstat(srcChild);
    if (st.isSymbolicLink()) {
      await copySymlinkSafe(srcChild, destChild);
      count += 1;
    } else if (st.isDirectory()) {
      count += await copyTreeSafe(srcChild, destChild);
    } else {
      await fs3.promises.copyFile(srcChild, destChild);
      const destSt = await fs3.promises.lstat(destChild);
      if (destSt.size !== st.size) {
        throw new Error(`Cross-device copy size mismatch for ${srcChild}`);
      }
      count += 1;
    }
  }
  return count;
}
__name(copyTreeSafe, "copyTreeSafe");
async function countTreeEntries(dir) {
  let count = 1;
  const entries = await fs3.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const child = path5.join(dir, entry.name);
    const st = await fs3.promises.lstat(child);
    if (st.isDirectory() && !st.isSymbolicLink()) {
      count += await countTreeEntries(child);
    } else {
      count += 1;
    }
  }
  return count;
}
__name(countTreeEntries, "countTreeEntries");
async function removeSourceSafe(srcPath) {
  const st = await fs3.promises.lstat(srcPath);
  if (st.isSymbolicLink()) {
    try {
      await fs3.promises.unlink(srcPath);
    } catch (err) {
      if (process.platform === "win32" && err.code === "EPERM") {
        await fs3.promises.rmdir(srcPath);
      } else {
        throw err;
      }
    }
    return;
  }
  try {
    await fs3.promises.rm(srcPath, { recursive: true, force: true });
  } catch (err) {
    if (process.platform === "win32") {
      await clearReadOnlyRecursive(srcPath);
      await fs3.promises.rm(srcPath, { recursive: true, force: true });
      return;
    }
    throw err;
  }
}
__name(removeSourceSafe, "removeSourceSafe");
async function moveToTrashLocation(srcPath, destPath) {
  await fs3.promises.mkdir(path5.dirname(destPath), { recursive: true });
  const srcStats = await fs3.promises.lstat(srcPath);
  try {
    await fs3.promises.rename(srcPath, destPath);
    return;
  } catch (err) {
    const code = err.code;
    if (code !== "EXDEV") {
      throw err;
    }
  }
  if (srcStats.isSymbolicLink()) {
    await copySymlinkSafe(srcPath, destPath);
    await removeSourceSafe(srcPath);
    return;
  }
  if (srcStats.isDirectory()) {
    const copiedCount = await copyTreeSafe(srcPath, destPath);
    const verifiedCount = await countTreeEntries(destPath);
    if (copiedCount !== verifiedCount) {
      throw new Error(`Cross-device directory verification mismatch for ${srcPath}`);
    }
    await removeSourceSafe(srcPath);
    return;
  }
  await fs3.promises.copyFile(srcPath, destPath);
  const destStats = await fs3.promises.lstat(destPath);
  if (destStats.size !== srcStats.size) {
    throw new Error(`Cross-device file verification mismatch for ${srcPath}`);
  }
  await removeSourceSafe(srcPath);
}
__name(moveToTrashLocation, "moveToTrashLocation");
async function safePermanentDelete(targetPath, trashRoot) {
  const itemsDir = path5.join(trashRoot, "items");
  if (!isPathInside(targetPath, itemsDir) || normalizeForCompare(targetPath) === normalizeForCompare(itemsDir)) {
    throw new Error(
      `Refusing permanent delete outside trash items boundary: ${targetPath} (itemsDir: ${itemsDir})`
    );
  }
  if (!fs3.existsSync(targetPath)) {
    return;
  }
  await removeSourceSafe(targetPath);
}
__name(safePermanentDelete, "safePermanentDelete");

// src/core/manifest.ts
import crypto from "node:crypto";
import fs4 from "node:fs";
import path6 from "node:path";
var MANIFEST_FILENAME = "manifest.json";
var LOCK_FILENAME = ".lock";
var LOCK_STALE_MS = 3e4;
var LOCK_TIMEOUT_MS = 5e3;
function getItemsDir(trashRoot) {
  return path6.join(trashRoot, "items");
}
__name(getItemsDir, "getItemsDir");
function getManifestPath(trashRoot) {
  return path6.join(trashRoot, MANIFEST_FILENAME);
}
__name(getManifestPath, "getManifestPath");
function ensureTrashRoot(trashRoot) {
  fs4.mkdirSync(trashRoot, { recursive: true });
  fs4.mkdirSync(getItemsDir(trashRoot), { recursive: true });
  const gitignorePath = path6.join(trashRoot, ".gitignore");
  if (!fs4.existsSync(gitignorePath)) {
    fs4.writeFileSync(gitignorePath, "*\n", "utf8");
  }
}
__name(ensureTrashRoot, "ensureTrashRoot");
function generateItemId(now = /* @__PURE__ */ new Date()) {
  const pad = /* @__PURE__ */ __name((n) => String(n).padStart(2, "0"), "pad");
  const datePart = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const timePart = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const hex = crypto.randomBytes(3).toString("hex");
  return `${datePart}-${timePart}-${hex}`;
}
__name(generateItemId, "generateItemId");
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
__name(sleep, "sleep");
async function withTrashLock(trashRoot, fn) {
  ensureTrashRoot(trashRoot);
  const lockPath = path6.join(trashRoot, LOCK_FILENAME);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd;
  while (true) {
    try {
      fd = fs4.openSync(lockPath, fs4.constants.O_CREAT | fs4.constants.O_EXCL | fs4.constants.O_WRONLY);
      fs4.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }), "utf8");
      fs4.closeSync(fd);
      fd = void 0;
      break;
    } catch (err) {
      const code = err.code;
      if (code !== "EEXIST") {
        throw err;
      }
      try {
        const st = fs4.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs4.unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for Sibyl trash lock at ${lockPath}`);
      }
      await sleep(25);
    }
  }
  try {
    return await fn();
  } finally {
    try {
      if (fs4.existsSync(lockPath)) {
        fs4.unlinkSync(lockPath);
      }
    } catch {
    }
  }
}
__name(withTrashLock, "withTrashLock");
function readManifest(trashRoot) {
  const manifestPath = getManifestPath(trashRoot);
  if (!fs4.existsSync(manifestPath)) {
    return { version: 1, items: [] };
  }
  const raw = fs4.readFileSync(manifestPath, "utf8");
  if (!raw.trim()) {
    return { version: 1, items: [] };
  }
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error(`Corrupt Sibyl manifest at ${manifestPath}`);
  }
  return {
    version: 1,
    items: parsed.items
  };
}
__name(readManifest, "readManifest");
async function writeManifest(trashRoot, manifest) {
  ensureTrashRoot(trashRoot);
  const manifestPath = getManifestPath(trashRoot);
  const tmpPath = path6.join(
    trashRoot,
    `${MANIFEST_FILENAME}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`
  );
  const content = JSON.stringify({ version: 1, items: manifest.items }, null, 2) + "\n";
  await fs4.promises.writeFile(tmpPath, content, "utf8");
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs4.promises.rename(tmpPath, manifestPath);
      return;
    } catch (err) {
      lastErr = err;
      const code = err.code;
      if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
        await sleep(20 * (attempt + 1));
        continue;
      }
      break;
    }
  }
  try {
    await fs4.promises.unlink(tmpPath);
  } catch {
  }
  throw lastErr;
}
__name(writeManifest, "writeManifest");

// src/core/trash-service.ts
function selectRootsByScope(scope, workspaceRoot, config) {
  const candidates = getCandidateTrashRoots(workspaceRoot, config);
  if (scope === "all") {
    return candidates;
  }
  const wsRoot = path7.join(path7.resolve(workspaceRoot), config.workspaceTrashDirName);
  if (scope === "workspace") {
    return [wsRoot];
  }
  const filtered = candidates.filter((r) => normalizeForCompare(r) !== normalizeForCompare(wsRoot));
  return filtered.length > 0 ? filtered : candidates;
}
__name(selectRootsByScope, "selectRootsByScope");
function lstatSafe(p) {
  try {
    return fs5.lstatSync(p);
  } catch {
    return void 0;
  }
}
__name(lstatSafe, "lstatSafe");
async function trashPaths(rawPaths, opts) {
  if (rawPaths.length === 0) {
    throw new Error("No paths provided to sibyl trash.");
  }
  const now = /* @__PURE__ */ new Date();
  const resolvedPairs = [];
  for (const raw of rawPaths) {
    const srcPath = path7.resolve(opts.cwd, raw);
    if (isFilesystemRoot(srcPath)) {
      throw new Error(`Refusing to trash filesystem root: ${srcPath}`);
    }
    const stats = lstatSafe(srcPath);
    if (!stats) {
      throw new Error(`Path does not exist: ${srcPath}`);
    }
    const trashRoot = resolveTrashRoot(srcPath, opts.workspaceRoot, opts.config);
    if (isPathInside(srcPath, trashRoot) || isPathInside(trashRoot, srcPath)) {
      throw new Error(`Refusing to trash protected trash root or its ancestor: ${srcPath}`);
    }
    resolvedPairs.push({ srcPath, trashRoot });
  }
  const grouped = /* @__PURE__ */ new Map();
  for (const { srcPath, trashRoot } of resolvedPairs) {
    const key = normalizeForCompare(trashRoot);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(srcPath);
    } else {
      grouped.set(key, [srcPath]);
    }
  }
  const moved = [];
  for (const [, pathsForRoot] of grouped) {
    const trashRoot = resolveTrashRoot(pathsForRoot[0], opts.workspaceRoot, opts.config);
    await withTrashLock(trashRoot, async () => {
      ensureTrashRoot(trashRoot);
      const manifest = readManifest(trashRoot);
      for (const srcPath of pathsForRoot) {
        const stats = await fs5.promises.lstat(srcPath);
        const entryType = detectEntryType(stats);
        const sizeBytes = await calculateSize(srcPath);
        let id = generateItemId(now);
        while (manifest.items.some((it) => it.id === id) || fs5.existsSync(path7.join(getItemsDir(trashRoot), id))) {
          id = generateItemId(/* @__PURE__ */ new Date());
        }
        const basename = path7.basename(srcPath);
        const storedRelPath = path7.posix.join("items", id, basename);
        const destPath = path7.join(trashRoot, "items", id, basename);
        await moveToTrashLocation(srcPath, destPath);
        const item = {
          id,
          originalPath: srcPath,
          storedRelPath,
          basename,
          entryType,
          sizeBytes,
          deletedAt: now.toISOString(),
          workspace: opts.workspaceRoot,
          sessionId: opts.sessionId,
          reason: opts.reason,
          sourceCommand: opts.sourceCommand
        };
        manifest.items.push(item);
        moved.push({ ...item, trashRoot });
      }
      await writeManifest(trashRoot, manifest);
    });
  }
  const status = getStatus({
    scope: "all",
    workspaceRoot: opts.workspaceRoot,
    config: opts.config,
    now
  });
  return { moved, status };
}
__name(trashPaths, "trashPaths");
function getStatus(opts) {
  const nowMs = (opts.now ?? /* @__PURE__ */ new Date()).getTime();
  const coolDownMs = opts.config.coolDownHours * 36e5;
  const roots = selectRootsByScope(opts.scope, opts.workspaceRoot, opts.config);
  const rootBreakdowns = [];
  let totalBytes = 0;
  let itemCount = 0;
  let protectedCount = 0;
  let protectedBytes = 0;
  let purgeableCount = 0;
  let purgeableBytes = 0;
  let oldestMs = Infinity;
  let newestMs = -Infinity;
  let oldestItemAt;
  let newestItemAt;
  let earliestUnlockMs = Infinity;
  for (const root of roots) {
    const manifest = readManifest(root);
    let rootBytes = 0;
    for (const item of manifest.items) {
      rootBytes += item.sizeBytes;
      totalBytes += item.sizeBytes;
      itemCount += 1;
      const deletedMs = Date.parse(item.deletedAt);
      if (Number.isFinite(deletedMs)) {
        if (deletedMs < oldestMs) {
          oldestMs = deletedMs;
          oldestItemAt = item.deletedAt;
        }
        if (deletedMs > newestMs) {
          newestMs = deletedMs;
          newestItemAt = item.deletedAt;
        }
        const ageMs = nowMs - deletedMs;
        if (ageMs >= coolDownMs) {
          purgeableCount += 1;
          purgeableBytes += item.sizeBytes;
        } else {
          protectedCount += 1;
          protectedBytes += item.sizeBytes;
          const unlockMs = deletedMs + coolDownMs;
          if (unlockMs < earliestUnlockMs) {
            earliestUnlockMs = unlockMs;
          }
        }
      } else {
        protectedCount += 1;
        protectedBytes += item.sizeBytes;
      }
    }
    rootBreakdowns.push({
      trashRoot: root,
      itemCount: manifest.items.length,
      totalBytes: rootBytes
    });
  }
  const maxBytes = opts.config.maxBytes;
  const watermarkBytes = Math.floor(maxBytes * opts.config.watermarkRatio);
  const quotaExceeded = totalBytes > maxBytes;
  return {
    scope: opts.scope,
    totalBytes,
    itemCount,
    maxBytes,
    watermarkRatio: opts.config.watermarkRatio,
    watermarkBytes,
    usageRatio: maxBytes > 0 ? totalBytes / maxBytes : 0,
    quotaExceeded,
    coolDownHours: opts.config.coolDownHours,
    protectedCount,
    protectedBytes,
    purgeableCount,
    purgeableBytes,
    canPurge: quotaExceeded && purgeableCount > 0,
    oldestItemAt,
    newestItemAt,
    earliestUnlockAt: Number.isFinite(earliestUnlockMs) ? new Date(earliestUnlockMs).toISOString() : void 0,
    roots: rootBreakdowns
  };
}
__name(getStatus, "getStatus");
function listItems(opts) {
  const nowMs = (opts.now ?? /* @__PURE__ */ new Date()).getTime();
  const coolDownMs = opts.config.coolDownHours * 36e5;
  const roots = selectRootsByScope(opts.scope, opts.workspaceRoot, opts.config);
  const items = [];
  for (const root of roots) {
    const manifest = readManifest(root);
    for (const item of manifest.items) {
      const deletedMs = Date.parse(item.deletedAt);
      const ageMs = Number.isFinite(deletedMs) ? Math.max(0, nowMs - deletedMs) : 0;
      items.push({
        ...item,
        trashRoot: root,
        ageHours: Number((ageMs / 36e5).toFixed(2)),
        inCoolDown: ageMs < coolDownMs
      });
    }
  }
  items.sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));
  if (opts.limit && opts.limit > 0) {
    return items.slice(0, opts.limit);
  }
  return items;
}
__name(listItems, "listItems");
async function restoreItem(id, opts) {
  const roots = selectRootsByScope("all", opts.workspaceRoot, opts.config);
  for (const root of roots) {
    const peek = readManifest(root);
    if (!peek.items.some((item) => item.id === id)) {
      continue;
    }
    return await withTrashLock(root, async () => {
      const manifest = readManifest(root);
      const idx = manifest.items.findIndex((item2) => item2.id === id);
      if (idx === -1) {
        throw new Error(`Trash item not found: ${id}`);
      }
      const item = manifest.items[idx];
      const storedPath = path7.join(root, ...item.storedRelPath.split("/"));
      if (!lstatSafe(storedPath)) {
        throw new Error(`Stored payload missing for item ${id} at ${storedPath}`);
      }
      const destPath = opts.to ? path7.resolve(opts.cwd, opts.to) : item.originalPath;
      let overwrittenBackupId;
      if (lstatSafe(destPath)) {
        if (!opts.overwrite) {
          throw new Error(
            `Destination already exists: ${destPath}. Pass --to <newPath> or --overwrite (or trash the existing path first).`
          );
        }
        const now = /* @__PURE__ */ new Date();
        const backupStats = await fs5.promises.lstat(destPath);
        let backupId = generateItemId(now);
        while (manifest.items.some((it) => it.id === backupId) || fs5.existsSync(path7.join(getItemsDir(root), backupId))) {
          backupId = generateItemId(/* @__PURE__ */ new Date());
        }
        const backupBasename = path7.basename(destPath);
        const backupRel = path7.posix.join("items", backupId, backupBasename);
        const backupDest = path7.join(root, "items", backupId, backupBasename);
        const backupSize = await calculateSize(destPath);
        await moveToTrashLocation(destPath, backupDest);
        manifest.items.push({
          id: backupId,
          originalPath: destPath,
          storedRelPath: backupRel,
          basename: backupBasename,
          entryType: detectEntryType(backupStats),
          sizeBytes: backupSize,
          deletedAt: now.toISOString(),
          workspace: opts.workspaceRoot,
          reason: `Overwrite backup before restoring ${id}`
        });
        overwrittenBackupId = backupId;
      }
      await fs5.promises.mkdir(path7.dirname(destPath), { recursive: true });
      await moveToTrashLocation(storedPath, destPath);
      const containerDir = path7.join(getItemsDir(root), item.id);
      if (fs5.existsSync(containerDir)) {
        await safePermanentDelete(containerDir, root);
      }
      manifest.items.splice(idx, 1);
      await writeManifest(root, manifest);
      return {
        item,
        restoredTo: destPath,
        trashRoot: root,
        overwrittenBackupId
      };
    });
  }
  throw new Error(`Trash item not found: ${id}`);
}
__name(restoreItem, "restoreItem");
async function purgeTrash(opts) {
  const now = opts.now ?? /* @__PURE__ */ new Date();
  const nowMs = now.getTime();
  const roots = selectRootsByScope(opts.scope, opts.workspaceRoot, opts.config);
  const maxBytes = opts.config.maxBytes;
  const watermarkBytes = Math.floor(maxBytes * opts.config.watermarkRatio);
  const coolDownMs = opts.config.coolDownHours * 36e5;
  const allEntries = [];
  let totalBytesBefore = 0;
  for (const root of roots) {
    const manifest = readManifest(root);
    for (const item of manifest.items) {
      allEntries.push({ ...item, trashRoot: root });
      totalBytesBefore += item.sizeBytes;
    }
  }
  const isExplicitOverride = Boolean(opts.force || opts.all || opts.ignoreCooldown || opts.id);
  if (isExplicitOverride) {
    let candidates = [...allEntries];
    if (opts.id) {
      candidates = candidates.filter((item) => item.id === opts.id);
    } else if (!opts.all) {
      if (!opts.ignoreCooldown) {
        candidates = candidates.filter((item) => nowMs - Date.parse(item.deletedAt) >= coolDownMs);
      }
      candidates.sort((a, b) => Date.parse(a.deletedAt) - Date.parse(b.deletedAt));
      if (!opts.force && totalBytesBefore <= maxBytes) {
        return {
          status: "under_quota",
          deleted: [],
          freedBytes: 0,
          totalBytesBefore,
          totalBytesAfter: totalBytesBefore,
          maxBytes,
          watermarkBytes
        };
      }
      if (!opts.force) {
        const planned2 = [];
        let running = totalBytesBefore;
        for (const item of candidates) {
          if (running <= watermarkBytes) break;
          planned2.push(item);
          running -= item.sizeBytes;
        }
        candidates = planned2;
      }
    }
    if (opts.dryRun) {
      const freedBytes = candidates.reduce((acc, it) => acc + it.sizeBytes, 0);
      return {
        status: "dry_run",
        deleted: candidates,
        freedBytes,
        totalBytesBefore,
        totalBytesAfter: totalBytesBefore - freedBytes,
        maxBytes,
        watermarkBytes
      };
    }
    return await executePurgePlan(candidates, totalBytesBefore, maxBytes, watermarkBytes);
  }
  if (totalBytesBefore <= maxBytes) {
    return {
      status: "under_quota",
      deleted: [],
      freedBytes: 0,
      totalBytesBefore,
      totalBytesAfter: totalBytesBefore,
      maxBytes,
      watermarkBytes
    };
  }
  const eligible = allEntries.filter((item) => {
    const deletedMs = Date.parse(item.deletedAt);
    return Number.isFinite(deletedMs) && nowMs - deletedMs >= coolDownMs;
  }).sort((a, b) => Date.parse(a.deletedAt) - Date.parse(b.deletedAt));
  if (eligible.length === 0) {
    let earliestUnlockMs = Infinity;
    for (const item of allEntries) {
      const deletedMs = Date.parse(item.deletedAt);
      if (Number.isFinite(deletedMs)) {
        earliestUnlockMs = Math.min(earliestUnlockMs, deletedMs + coolDownMs);
      }
    }
    return {
      status: "all_in_cooldown",
      deleted: [],
      freedBytes: 0,
      totalBytesBefore,
      totalBytesAfter: totalBytesBefore,
      maxBytes,
      watermarkBytes,
      earliestUnlockAt: Number.isFinite(earliestUnlockMs) ? new Date(earliestUnlockMs).toISOString() : void 0
    };
  }
  const planned = [];
  let remaining = totalBytesBefore;
  for (const item of eligible) {
    if (remaining <= watermarkBytes) {
      break;
    }
    planned.push(item);
    remaining -= item.sizeBytes;
  }
  if (opts.dryRun) {
    const freedBytes = planned.reduce((acc, it) => acc + it.sizeBytes, 0);
    return {
      status: "dry_run",
      deleted: planned,
      freedBytes,
      totalBytesBefore,
      totalBytesAfter: totalBytesBefore - freedBytes,
      maxBytes,
      watermarkBytes
    };
  }
  return await executePurgePlan(planned, totalBytesBefore, maxBytes, watermarkBytes);
}
__name(purgeTrash, "purgeTrash");
async function executePurgePlan(planned, totalBytesBefore, maxBytes, watermarkBytes) {
  const byRoot = /* @__PURE__ */ new Map();
  for (const item of planned) {
    const key = normalizeForCompare(item.trashRoot);
    const group = byRoot.get(key);
    if (group) {
      group.push(item);
    } else {
      byRoot.set(key, [item]);
    }
  }
  const deleted = [];
  let freedBytes = 0;
  for (const [, items] of byRoot) {
    const root = items[0].trashRoot;
    await withTrashLock(root, async () => {
      const manifest = readManifest(root);
      const idSet = new Set(items.map((it) => it.id));
      for (const item of items) {
        const containerDir = path7.join(getItemsDir(root), item.id);
        await safePermanentDelete(containerDir, root);
        deleted.push(item);
        freedBytes += item.sizeBytes;
      }
      manifest.items = manifest.items.filter((it) => !idSet.has(it.id));
      await writeManifest(root, manifest);
    });
  }
  return {
    status: "purged",
    deleted,
    freedBytes,
    totalBytesBefore,
    totalBytesAfter: Math.max(0, totalBytesBefore - freedBytes),
    maxBytes,
    watermarkBytes
  };
}
__name(executePurgePlan, "executePurgePlan");

// src/init/installer.ts
import fs6 from "node:fs";
import os3 from "node:os";
import path8 from "node:path";
var RULE_BEGIN = "<!-- sibyl:begin -->";
var RULE_END = "<!-- sibyl:end -->";
function copyDirRecursive(srcDir, destDir) {
  fs6.mkdirSync(destDir, { recursive: true });
  const entries = fs6.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path8.join(srcDir, entry.name);
    const destPath = path8.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs6.copyFileSync(srcPath, destPath);
      if (process.platform !== "win32" && entry.name.endsWith(".mjs")) {
        fs6.chmodSync(destPath, 493);
      }
    }
  }
}
__name(copyDirRecursive, "copyDirRecursive");
function readJsonOrEmpty(filePath) {
  if (!fs6.existsSync(filePath)) {
    return {};
  }
  const raw = fs6.readFileSync(filePath, "utf8").trim();
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object in ${filePath}`);
  }
  return parsed;
}
__name(readJsonOrEmpty, "readJsonOrEmpty");
function writeJsonPretty(filePath, data) {
  fs6.mkdirSync(path8.dirname(filePath), { recursive: true });
  fs6.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}
__name(writeJsonPretty, "writeJsonPretty");
function buildRuleBlock(runtimeScriptPath) {
  const rt = toForwardSlashes(runtimeScriptPath);
  return [
    RULE_BEGIN,
    "## Sibyl Safe-Deletion Policy",
    "",
    "- **Never permanently delete files or directories** using native commands (`rm`, `rmdir`, `unlink`, `del`, `Remove-Item`, `git clean -f`, `git reset --hard`) or inline scripts (`python -c`, `node -e`).",
    `- Always move unwanted paths to the Sibyl trash instead: \`node "${rt}" trash -- <paths>\` (or call the \`sibyl_trash\` MCP tool).`,
    `- Query trash quota with \`node "${rt}" status\`, inspect/recover with \`list\` and \`restore <id>\`, and run quota-gated cleanup with \`purge\`.`,
    RULE_END
  ].join("\n");
}
__name(buildRuleBlock, "buildRuleBlock");
function upsertRuleMarkdown(filePath, block) {
  fs6.mkdirSync(path8.dirname(filePath), { recursive: true });
  if (!fs6.existsSync(filePath)) {
    fs6.writeFileSync(filePath, block + "\n", "utf8");
    return;
  }
  const existing = fs6.readFileSync(filePath, "utf8");
  const startIdx = existing.indexOf(RULE_BEGIN);
  const endIdx = existing.indexOf(RULE_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const updated = existing.slice(0, startIdx) + block + existing.slice(endIdx + RULE_END.length);
    fs6.writeFileSync(filePath, updated, "utf8");
    return;
  }
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  fs6.writeFileSync(filePath, existing + sep + block + "\n", "utf8");
}
__name(upsertRuleMarkdown, "upsertRuleMarkdown");
function installAntigravityHooks(hooksJsonPath, runtimeScriptPath) {
  const data = readJsonOrEmpty(hooksJsonPath);
  const hookCmd = `node "${toForwardSlashes(runtimeScriptPath)}" hook --harness antigravity`;
  data["sibyl-guard"] = {
    enabled: true,
    SessionStart: [
      {
        type: "command",
        command: hookCmd,
        timeout: 10
      }
    ],
    PreToolUse: [
      {
        matcher: "run_command|write_file|edit_file",
        hooks: [
          {
            type: "command",
            command: hookCmd,
            timeout: 10
          }
        ]
      }
    ]
  };
  writeJsonPretty(hooksJsonPath, data);
}
__name(installAntigravityHooks, "installAntigravityHooks");
function isSibylClaudeHookGroup(group) {
  if (!group || typeof group !== "object") {
    return false;
  }
  const hooks = group.hooks;
  if (!Array.isArray(hooks)) {
    return false;
  }
  return hooks.some(
    (h) => h && typeof h === "object" && typeof h.command === "string" && h.command.includes("sibyl.mjs")
  );
}
__name(isSibylClaudeHookGroup, "isSibylClaudeHookGroup");
function installClaudeHooks(settingsPath, runtimeScriptPath) {
  const data = readJsonOrEmpty(settingsPath);
  const hookCmd = `node "${toForwardSlashes(runtimeScriptPath)}" hook --harness claude`;
  const hooksObj = data.hooks && typeof data.hooks === "object" && !Array.isArray(data.hooks) ? { ...data.hooks } : {};
  const existingSession = Array.isArray(hooksObj.SessionStart) ? hooksObj.SessionStart : [];
  const filteredSession = existingSession.filter((g) => !isSibylClaudeHookGroup(g));
  filteredSession.push({
    hooks: [{ type: "command", command: hookCmd, timeout: 10 }]
  });
  hooksObj.SessionStart = filteredSession;
  const existingPre = Array.isArray(hooksObj.PreToolUse) ? hooksObj.PreToolUse : [];
  const filteredPre = existingPre.filter((g) => !isSibylClaudeHookGroup(g));
  filteredPre.push({
    matcher: "Bash|Write|Edit|MultiEdit",
    hooks: [{ type: "command", command: hookCmd, timeout: 10 }]
  });
  hooksObj.PreToolUse = filteredPre;
  data.hooks = hooksObj;
  writeJsonPretty(settingsPath, data);
}
__name(installClaudeHooks, "installClaudeHooks");
function appendRootGitignore(workspaceRoot) {
  const gitignorePath = path8.join(workspaceRoot, ".gitignore");
  if (!fs6.existsSync(gitignorePath)) {
    fs6.writeFileSync(gitignorePath, ".sibyl-trash/\n", "utf8");
    return true;
  }
  const raw = fs6.readFileSync(gitignorePath, "utf8");
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  if (lines.includes(".sibyl-trash/") || lines.includes(".sibyl-trash")) {
    return false;
  }
  const sep = raw.endsWith("\n") || raw.length === 0 ? "" : "\n";
  fs6.writeFileSync(gitignorePath, `${raw}${sep}.sibyl-trash/
`, "utf8");
  return true;
}
__name(appendRootGitignore, "appendRootGitignore");
function runInit(opts) {
  const updatedFiles = [];
  const workspaceRoot = path8.resolve(opts.cwd);
  const homeDir = os3.homedir();
  const targets = opts.target === "all" ? ["antigravity", "claude"] : [opts.target];
  let lastRuntimeScript = path8.join(opts.sourceSkillDir, "scripts", "sibyl.mjs");
  for (const t of targets) {
    if (t === "antigravity") {
      const baseDir = opts.scope === "workspace" ? path8.join(workspaceRoot, ".agents") : path8.join(homeDir, ".gemini", "config");
      const skillDest = path8.join(baseDir, "skills", "sibyl");
      if (path8.resolve(opts.sourceSkillDir) !== path8.resolve(skillDest)) {
        copyDirRecursive(opts.sourceSkillDir, skillDest);
        updatedFiles.push(skillDest);
      }
      const runtimeScript = path8.join(skillDest, "scripts", "sibyl.mjs");
      lastRuntimeScript = runtimeScript;
      const hooksPath = path8.join(baseDir, "hooks.json");
      installAntigravityHooks(hooksPath, runtimeScript);
      updatedFiles.push(hooksPath);
      if (opts.scope === "workspace") {
        const agentsMd = path8.join(workspaceRoot, "AGENTS.md");
        upsertRuleMarkdown(agentsMd, buildRuleBlock(runtimeScript));
        updatedFiles.push(agentsMd);
      }
    } else {
      const baseDir = opts.scope === "workspace" ? path8.join(workspaceRoot, ".claude") : path8.join(homeDir, ".claude");
      const skillDest = path8.join(baseDir, "skills", "sibyl");
      if (path8.resolve(opts.sourceSkillDir) !== path8.resolve(skillDest)) {
        copyDirRecursive(opts.sourceSkillDir, skillDest);
        updatedFiles.push(skillDest);
      }
      const runtimeScript = path8.join(skillDest, "scripts", "sibyl.mjs");
      lastRuntimeScript = runtimeScript;
      const settingsPath = path8.join(baseDir, "settings.json");
      installClaudeHooks(settingsPath, runtimeScript);
      updatedFiles.push(settingsPath);
      if (opts.scope === "workspace") {
        const claudeMd = path8.join(workspaceRoot, "CLAUDE.md");
        upsertRuleMarkdown(claudeMd, buildRuleBlock(runtimeScript));
        updatedFiles.push(claudeMd);
      }
    }
  }
  if (opts.scope === "workspace" && opts.updateGitignore) {
    const gitignorePath = path8.join(workspaceRoot, ".gitignore");
    if (appendRootGitignore(workspaceRoot)) {
      updatedFiles.push(gitignorePath);
    }
  }
  let mcpConfig;
  if (opts.withMcp) {
    mcpConfig = {
      mcpServers: {
        sibyl: {
          command: "node",
          args: [toForwardSlashes(lastRuntimeScript), "mcp"]
        }
      }
    };
  }
  return {
    target: opts.target,
    scope: opts.scope,
    updatedFiles,
    mcpConfig
  };
}
__name(runInit, "runInit");

// src/mcp/server.ts
import readline from "node:readline";
var MCP_TOOLS = [
  {
    name: "sibyl_trash",
    description: "Safely move files, directories, or symlinks into the Sibyl trash instead of permanently deleting them.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "File or directory paths to move to trash."
        },
        reason: {
          type: "string",
          description: "Optional reason for trashing these items."
        },
        cwd: {
          type: "string",
          description: "Working directory to resolve relative paths from."
        }
      },
      required: ["paths"]
    }
  },
  {
    name: "sibyl_status",
    description: "Query Sibyl trash size, quota usage, cool-down protected bytes, and whether autonomous purge is unlocked.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["workspace", "global", "all"],
          description: "Trash scope to inspect (default: all)."
        },
        cwd: {
          type: "string",
          description: "Working directory for workspace resolution."
        }
      }
    }
  },
  {
    name: "sibyl_list",
    description: "List trashed items with IDs, original paths, sizes, and cool-down status.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["workspace", "global", "all"],
          description: "Trash scope to list (default: all)."
        },
        limit: {
          type: "number",
          description: "Maximum number of newest items to return."
        },
        cwd: {
          type: "string",
          description: "Working directory for workspace resolution."
        }
      }
    }
  },
  {
    name: "sibyl_restore",
    description: "Restore a trashed item by its ID back to its original path or a custom destination.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Trash item ID from sibyl_list or sibyl_trash."
        },
        to: {
          type: "string",
          description: "Optional alternative destination path."
        },
        overwrite: {
          type: "boolean",
          description: "If destination exists, back it up into trash before restoring."
        },
        cwd: {
          type: "string",
          description: "Working directory for resolving relative --to path and workspace."
        }
      },
      required: ["id"]
    }
  },
  {
    name: "sibyl_purge",
    description: "Autonomously purge expired trash items FIFO down to the safety watermark ONLY when quota is exceeded and items have passed the cool-down period.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["workspace", "global", "all"],
          description: "Trash scope to purge (default: all)."
        },
        dryRun: {
          type: "boolean",
          description: "Preview planned deletions without removing files."
        },
        cwd: {
          type: "string",
          description: "Working directory for workspace resolution."
        }
      }
    }
  }
];
function writeJsonLine(obj) {
  process.stdout.write(`${JSON.stringify(obj)}
`);
}
__name(writeJsonLine, "writeJsonLine");
function sendResult(id, result) {
  writeJsonLine({ jsonrpc: "2.0", id, result });
}
__name(sendResult, "sendResult");
function sendError(id, code, message) {
  writeJsonLine({ jsonrpc: "2.0", id, error: { code, message } });
}
__name(sendError, "sendError");
function asScope(val) {
  if (val === "workspace" || val === "global" || val === "all") {
    return val;
  }
  return "all";
}
__name(asScope, "asScope");
async function callMcpTool(name, args, defaultWorkspace) {
  const cwd = typeof args.cwd === "string" && args.cwd.trim() ? args.cwd : defaultWorkspace;
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const config = loadConfig(workspaceRoot);
  switch (name) {
    case "sibyl_trash": {
      const paths = Array.isArray(args.paths) ? args.paths.filter((p) => typeof p === "string" && p.trim().length > 0) : [];
      if (paths.length === 0) {
        throw new Error("sibyl_trash requires a non-empty `paths` string array.");
      }
      const reason = typeof args.reason === "string" ? args.reason : void 0;
      return await trashPaths(paths, { cwd, workspaceRoot, config, reason });
    }
    case "sibyl_status": {
      return getStatus({ scope: asScope(args.scope), workspaceRoot, config });
    }
    case "sibyl_list": {
      const limit = typeof args.limit === "number" ? args.limit : void 0;
      return listItems({ scope: asScope(args.scope), workspaceRoot, config, limit });
    }
    case "sibyl_restore": {
      const id = typeof args.id === "string" ? args.id.trim() : "";
      if (!id) {
        throw new Error("sibyl_restore requires `id`.");
      }
      const to = typeof args.to === "string" ? args.to : void 0;
      const overwrite = Boolean(args.overwrite);
      return await restoreItem(id, { to, overwrite, cwd, workspaceRoot, config });
    }
    case "sibyl_purge": {
      if (config.purgePolicy === "deny") {
        throw new Error("Purge is disabled by purgePolicy=deny.");
      }
      const dryRun = Boolean(args.dryRun);
      return await purgeTrash({
        scope: asScope(args.scope),
        workspaceRoot,
        config,
        dryRun
      });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
__name(callMcpTool, "callMcpTool");
async function startMcpServer(defaultWorkspace = process.cwd()) {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let req;
    try {
      req = JSON.parse(trimmed);
    } catch {
      sendError(null, -32700, "Parse error");
      continue;
    }
    const hasId = req.id !== void 0 && req.id !== null;
    const reqId = req.id ?? null;
    if (req.method === "notifications/initialized" || req.method === "notifications/cancelled") {
      continue;
    }
    if (req.method === "initialize") {
      const protocolVersion = typeof req.params?.protocolVersion === "string" ? req.params.protocolVersion : "2024-11-05";
      if (hasId) {
        sendResult(reqId, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "sibyl", version: "0.1.0" }
        });
      }
      continue;
    }
    if (req.method === "ping") {
      if (hasId) sendResult(reqId, {});
      continue;
    }
    if (req.method === "tools/list") {
      if (hasId) sendResult(reqId, { tools: MCP_TOOLS });
      continue;
    }
    if (req.method === "tools/call") {
      const toolName = typeof req.params?.name === "string" ? req.params.name : "";
      const toolArgs = req.params?.arguments && typeof req.params.arguments === "object" ? req.params.arguments : {};
      try {
        const result = await callMcpTool(toolName, toolArgs, defaultWorkspace);
        if (hasId) {
          sendResult(reqId, {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: false
          });
        }
      } catch (err) {
        if (hasId) {
          sendResult(reqId, {
            content: [{ type: "text", text: err.message }],
            isError: true
          });
        }
      }
      continue;
    }
    if (hasId) {
      sendError(reqId, -32601, `Method not found: ${req.method}`);
    }
  }
}
__name(startMcpServer, "startMcpServer");

// src/cli.ts
function formatBytes(bytes) {
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
__name(formatBytes, "formatBytes");
function getRuntimeScriptPath() {
  return path9.resolve(fileURLToPath(import.meta.url));
}
__name(getRuntimeScriptPath, "getRuntimeScriptPath");
function getSourceSkillDir() {
  const scriptPath = getRuntimeScriptPath();
  const candidate = path9.resolve(path9.dirname(scriptPath), "..");
  if (fs7.existsSync(path9.join(candidate, "SKILL.md"))) {
    return candidate;
  }
  const repoCandidate = path9.resolve(path9.dirname(scriptPath), "..", "skills", "sibyl");
  if (fs7.existsSync(path9.join(repoCandidate, "SKILL.md"))) {
    return repoCandidate;
  }
  return candidate;
}
__name(getSourceSkillDir, "getSourceSkillDir");
function printHelp() {
  console.log(
    [
      "Sibyl \u2014 Safe-deletion trash CLI, Hook guard & MCP server",
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
      "  sibyl config [--cwd <dir>] [--json]"
    ].join("\n")
  );
}
__name(printHelp, "printHelp");
async function readStdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
__name(readStdinText, "readStdinText");
function parseFlags(argv) {
  const flags = /* @__PURE__ */ new Map();
  const positional = [];
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
        if (next !== void 0 && !next.startsWith("-") && (key === "cwd" || key === "reason" || key === "session-id" || key === "scope" || key === "limit" || key === "to" || key === "id" || key === "harness" || key === "target")) {
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
__name(parseFlags, "parseFlags");
function asScope2(val) {
  if (val === "workspace" || val === "global" || val === "all") {
    return val;
  }
  return "all";
}
__name(asScope2, "asScope");
async function main() {
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
  const cwd = typeof flags.get("cwd") === "string" ? path9.resolve(String(flags.get("cwd"))) : process.cwd();
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
        reason: typeof flags.get("reason") === "string" ? String(flags.get("reason")) : void 0,
        sessionId: typeof flags.get("session-id") === "string" ? String(flags.get("session-id")) : void 0
      });
      if (asJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        for (const item of res.moved) {
          console.log(
            `Trashed [${item.id}] ${item.originalPath} -> ${path9.join(item.trashRoot, item.storedRelPath)} (${formatBytes(item.sizeBytes)})`
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
      const status = getStatus({ scope: asScope2(flags.get("scope")), workspaceRoot, config });
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
      const limit = typeof flags.get("limit") === "string" ? Number(flags.get("limit")) : void 0;
      const items = listItems({
        scope: asScope2(flags.get("scope")),
        workspaceRoot,
        config,
        limit
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
        to: typeof flags.get("to") === "string" ? String(flags.get("to")) : void 0,
        overwrite: Boolean(flags.get("overwrite")),
        cwd,
        workspaceRoot,
        config
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
        scope: asScope2(flags.get("scope")),
        workspaceRoot,
        config,
        dryRun: Boolean(flags.get("dry-run")),
        force: Boolean(flags.get("force")),
        all: Boolean(flags.get("all")),
        ignoreCooldown: Boolean(flags.get("ignore-cooldown")),
        id: typeof flags.get("id") === "string" ? String(flags.get("id")) : void 0
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
      const explicitHarness = typeof flags.get("harness") === "string" ? String(flags.get("harness")) : void 0;
      try {
        const raw = await readStdinText();
        const payload = raw.trim() ? JSON.parse(raw) : {};
        const output = handleHookPayload(payload, {
          explicitHarness,
          runtimePath: getRuntimeScriptPath(),
          fallbackCwd: cwd
        });
        process.stdout.write(JSON.stringify(output) + "\n");
      } catch (err) {
        const fallbackOut = explicitHarness === "claude" ? {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `Sibyl hook internal error: ${err.message}`
          }
        } : {
          decision: "deny",
          reason: `Sibyl hook internal error: ${err.message}`
        };
        process.stdout.write(JSON.stringify(fallbackOut) + "\n");
      }
      return;
    }
    case "init": {
      const targetArg = typeof flags.get("target") === "string" ? String(flags.get("target")) : "all";
      const scopeArg = typeof flags.get("scope") === "string" ? String(flags.get("scope")) : "workspace";
      const target = targetArg === "antigravity" || targetArg === "claude" || targetArg === "all" ? targetArg : "all";
      const scope = scopeArg === "global" ? "global" : "workspace";
      const report = runInit({
        target,
        scope,
        cwd,
        updateGitignore: Boolean(flags.get("update-gitignore")),
        withMcp: Boolean(flags.get("with-mcp")),
        sourceSkillDir: getSourceSkillDir()
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
__name(main, "main");
main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});

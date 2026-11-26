import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type TrashMode = "workspace-first" | "global" | "custom";
export type PurgePolicy = "autonomous" | "ask" | "deny";
export type GitDestructivePolicy = "deny" | "ask" | "allow";
export type SelfProtectPolicy = "deny" | "ask";

export interface SibylConfig {
  trashMode: TrashMode;
  customTrashDir?: string;
  workspaceTrashDirName: string;
  maxBytes: number;
  watermarkRatio: number;
  coolDownHours: number;
  allowDirectDeletePatterns: string[];
  purgePolicy: PurgePolicy;
  gitDestructivePolicy: GitDestructivePolicy;
  selfProtectPolicy: SelfProtectPolicy;
}

export const DEFAULT_CONFIG: SibylConfig = {
  trashMode: "workspace-first",
  workspaceTrashDirName: ".sibyl-trash",
  maxBytes: 1024 * 1024 * 1024, // 1 GiB
  watermarkRatio: 0.5, // 50%
  coolDownHours: 24,
  allowDirectDeletePatterns: [],
  purgePolicy: "autonomous",
  gitDestructivePolicy: "deny",
  selfProtectPolicy: "deny",
};

const TRASH_MODES: ReadonlySet<string> = new Set(["workspace-first", "global", "custom"]);
const PURGE_POLICIES: ReadonlySet<string> = new Set(["autonomous", "ask", "deny"]);
const GIT_POLICIES: ReadonlySet<string> = new Set(["deny", "ask", "allow"]);
const SELF_PROTECT_POLICIES: ReadonlySet<string> = new Set(["deny", "ask"]);

export function getSibylHome(): string {
  const envHome = process.env.SIBYL_HOME?.trim();
  if (envHome) {
    return path.resolve(envHome);
  }
  return path.join(os.homedir(), ".sibyl");
}

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Malformed Sibyl config JSON at ${filePath}: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid Sibyl config at ${filePath}: expected a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function clampNumber(value: unknown, fallback: number, min: number, max?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  let v = Math.max(min, value);
  if (max !== undefined) {
    v = Math.min(max, v);
  }
  return v;
}

function sanitizeDirName(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || trimmed.includes("/") || trimmed.includes("\\")) {
    return fallback;
  }
  return trimmed;
}

function mergeConfigLayer(base: SibylConfig, layer?: Record<string, unknown>): SibylConfig {
  if (!layer) {
    return base;
  }
  const next: SibylConfig = { ...base, allowDirectDeletePatterns: [...base.allowDirectDeletePatterns] };

  if (typeof layer.trashMode === "string" && TRASH_MODES.has(layer.trashMode)) {
    next.trashMode = layer.trashMode as TrashMode;
  }
  if (typeof layer.customTrashDir === "string" && layer.customTrashDir.trim().length > 0) {
    next.customTrashDir = layer.customTrashDir.trim();
  }
  if (layer.workspaceTrashDirName !== undefined) {
    next.workspaceTrashDirName = sanitizeDirName(layer.workspaceTrashDirName, next.workspaceTrashDirName);
  }
  if (layer.maxBytes !== undefined) {
    next.maxBytes = Math.floor(clampNumber(layer.maxBytes, next.maxBytes, 1024));
  }
  if (layer.watermarkRatio !== undefined) {
    next.watermarkRatio = clampNumber(layer.watermarkRatio, next.watermarkRatio, 0.1, 0.95);
  }
  if (layer.coolDownHours !== undefined) {
    next.coolDownHours = clampNumber(layer.coolDownHours, next.coolDownHours, 0);
  }
  if (Array.isArray(layer.allowDirectDeletePatterns)) {
    next.allowDirectDeletePatterns = layer.allowDirectDeletePatterns
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim());
  }
  if (typeof layer.purgePolicy === "string" && PURGE_POLICIES.has(layer.purgePolicy)) {
    next.purgePolicy = layer.purgePolicy as PurgePolicy;
  }
  if (typeof layer.gitDestructivePolicy === "string" && GIT_POLICIES.has(layer.gitDestructivePolicy)) {
    next.gitDestructivePolicy = layer.gitDestructivePolicy as GitDestructivePolicy;
  }
  if (typeof layer.selfProtectPolicy === "string" && SELF_PROTECT_POLICIES.has(layer.selfProtectPolicy)) {
    next.selfProtectPolicy = layer.selfProtectPolicy as SelfProtectPolicy;
  }

  return next;
}

export function loadConfig(workspaceRoot?: string): SibylConfig {
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

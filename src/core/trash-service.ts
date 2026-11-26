import fs from "node:fs";
import path from "node:path";
import type { SibylConfig } from "./config.js";
import { calculateSize, detectEntryType, moveToTrashLocation, safePermanentDelete } from "./fs-ops.js";
import {
  ensureTrashRoot,
  generateItemId,
  getItemsDir,
  readManifest,
  withTrashLock,
  writeManifest,
  type TrashItem,
} from "./manifest.js";
import {
  getCandidateTrashRoots,
  isFilesystemRoot,
  isPathInside,
  normalizeForCompare,
  resolveTrashRoot,
} from "./paths.js";

export type TrashScope = "workspace" | "global" | "all";

export interface TrashOperationOptions {
  cwd: string;
  workspaceRoot: string;
  config: SibylConfig;
  reason?: string;
  sessionId?: string;
  sourceCommand?: string;
}

export interface TrashResult {
  moved: Array<TrashItem & { trashRoot: string }>;
  status: StatusSummary;
}

export interface RootBreakdown {
  trashRoot: string;
  itemCount: number;
  totalBytes: number;
}

export interface StatusSummary {
  scope: TrashScope;
  totalBytes: number;
  itemCount: number;
  maxBytes: number;
  watermarkRatio: number;
  watermarkBytes: number;
  usageRatio: number;
  quotaExceeded: boolean;
  coolDownHours: number;
  protectedCount: number;
  protectedBytes: number;
  purgeableCount: number;
  purgeableBytes: number;
  canPurge: boolean;
  oldestItemAt?: string;
  newestItemAt?: string;
  earliestUnlockAt?: string;
  roots: RootBreakdown[];
}

export interface ListedItem extends TrashItem {
  trashRoot: string;
  ageHours: number;
  inCoolDown: boolean;
}

export interface RestoreOptions {
  to?: string;
  overwrite?: boolean;
  cwd: string;
  workspaceRoot: string;
  config: SibylConfig;
}

export interface RestoreResult {
  item: TrashItem;
  restoredTo: string;
  trashRoot: string;
  overwrittenBackupId?: string;
}

export interface PurgeOptions {
  scope: TrashScope;
  workspaceRoot: string;
  config: SibylConfig;
  dryRun?: boolean;
  force?: boolean;
  all?: boolean;
  ignoreCooldown?: boolean;
  id?: string;
  now?: Date;
}

export interface PurgeResult {
  status: "under_quota" | "all_in_cooldown" | "dry_run" | "purged";
  deleted: Array<TrashItem & { trashRoot: string }>;
  freedBytes: number;
  totalBytesBefore: number;
  totalBytesAfter: number;
  maxBytes: number;
  watermarkBytes: number;
  earliestUnlockAt?: string;
}

function selectRootsByScope(
  scope: TrashScope,
  workspaceRoot: string,
  config: SibylConfig
): string[] {
  const candidates = getCandidateTrashRoots(workspaceRoot, config);
  if (scope === "all") {
    return candidates;
  }
  const wsRoot = path.join(path.resolve(workspaceRoot), config.workspaceTrashDirName);
  if (scope === "workspace") {
    return [wsRoot];
  }
  // global
  const filtered = candidates.filter((r) => normalizeForCompare(r) !== normalizeForCompare(wsRoot));
  return filtered.length > 0 ? filtered : candidates;
}

function lstatSafe(p: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(p);
  } catch {
    return undefined;
  }
}

export async function trashPaths(
  rawPaths: string[],
  opts: TrashOperationOptions
): Promise<TrashResult> {
  if (rawPaths.length === 0) {
    throw new Error("No paths provided to sibyl trash.");
  }

  const now = new Date();
  const resolvedPairs: Array<{ srcPath: string; trashRoot: string }> = [];

  for (const raw of rawPaths) {
    const srcPath = path.resolve(opts.cwd, raw);
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

  // Group by trash root to lock once per root.
  const grouped = new Map<string, string[]>();
  for (const { srcPath, trashRoot } of resolvedPairs) {
    const key = normalizeForCompare(trashRoot);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(srcPath);
    } else {
      grouped.set(key, [srcPath]);
    }
  }

  const moved: Array<TrashItem & { trashRoot: string }> = [];
  for (const [, pathsForRoot] of grouped) {
    const trashRoot = resolveTrashRoot(pathsForRoot[0], opts.workspaceRoot, opts.config);
    await withTrashLock(trashRoot, async () => {
      ensureTrashRoot(trashRoot);
      const manifest = readManifest(trashRoot);

      for (const srcPath of pathsForRoot) {
        const stats = await fs.promises.lstat(srcPath);
        const entryType = detectEntryType(stats);
        const sizeBytes = await calculateSize(srcPath);
        let id = generateItemId(now);
        while (
          manifest.items.some((it) => it.id === id) ||
          fs.existsSync(path.join(getItemsDir(trashRoot), id))
        ) {
          id = generateItemId(new Date());
        }
        const basename = path.basename(srcPath);
        const storedRelPath = path.posix.join("items", id, basename);
        const destPath = path.join(trashRoot, "items", id, basename);

        await moveToTrashLocation(srcPath, destPath);

        const item: TrashItem = {
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
          sourceCommand: opts.sourceCommand,
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
    now,
  });
  return { moved, status };
}

export function getStatus(opts: {
  scope: TrashScope;
  workspaceRoot: string;
  config: SibylConfig;
  now?: Date;
}): StatusSummary {
  const nowMs = (opts.now ?? new Date()).getTime();
  const coolDownMs = opts.config.coolDownHours * 3600_000;
  const roots = selectRootsByScope(opts.scope, opts.workspaceRoot, opts.config);
  const rootBreakdowns: RootBreakdown[] = [];

  let totalBytes = 0;
  let itemCount = 0;
  let protectedCount = 0;
  let protectedBytes = 0;
  let purgeableCount = 0;
  let purgeableBytes = 0;
  let oldestMs = Infinity;
  let newestMs = -Infinity;
  let oldestItemAt: string | undefined;
  let newestItemAt: string | undefined;
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
      totalBytes: rootBytes,
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
    earliestUnlockAt: Number.isFinite(earliestUnlockMs)
      ? new Date(earliestUnlockMs).toISOString()
      : undefined,
    roots: rootBreakdowns,
  };
}

export function listItems(opts: {
  scope: TrashScope;
  workspaceRoot: string;
  config: SibylConfig;
  limit?: number;
  now?: Date;
}): ListedItem[] {
  const nowMs = (opts.now ?? new Date()).getTime();
  const coolDownMs = opts.config.coolDownHours * 3600_000;
  const roots = selectRootsByScope(opts.scope, opts.workspaceRoot, opts.config);
  const items: ListedItem[] = [];

  for (const root of roots) {
    const manifest = readManifest(root);
    for (const item of manifest.items) {
      const deletedMs = Date.parse(item.deletedAt);
      const ageMs = Number.isFinite(deletedMs) ? Math.max(0, nowMs - deletedMs) : 0;
      items.push({
        ...item,
        trashRoot: root,
        ageHours: Number((ageMs / 3600_000).toFixed(2)),
        inCoolDown: ageMs < coolDownMs,
      });
    }
  }

  items.sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));
  if (opts.limit && opts.limit > 0) {
    return items.slice(0, opts.limit);
  }
  return items;
}

export async function restoreItem(id: string, opts: RestoreOptions): Promise<RestoreResult> {
  const roots = selectRootsByScope("all", opts.workspaceRoot, opts.config);

  for (const root of roots) {
    const peek = readManifest(root);
    if (!peek.items.some((item) => item.id === id)) {
      continue;
    }

    return await withTrashLock(root, async () => {
      const manifest = readManifest(root);
      const idx = manifest.items.findIndex((item) => item.id === id);
      if (idx === -1) {
        throw new Error(`Trash item not found: ${id}`);
      }
      const item = manifest.items[idx];
      const storedPath = path.join(root, ...item.storedRelPath.split("/"));
      if (!lstatSafe(storedPath)) {
        throw new Error(`Stored payload missing for item ${id} at ${storedPath}`);
      }

      const destPath = opts.to ? path.resolve(opts.cwd, opts.to) : item.originalPath;
      let overwrittenBackupId: string | undefined;

      if (lstatSafe(destPath)) {
        if (!opts.overwrite) {
          throw new Error(
            `Destination already exists: ${destPath}. Pass --to <newPath> or --overwrite (or trash the existing path first).`
          );
        }
        // Safely move existing destination to trash before restoring
        const now = new Date();
        const backupStats = await fs.promises.lstat(destPath);
        let backupId = generateItemId(now);
        while (
          manifest.items.some((it) => it.id === backupId) ||
          fs.existsSync(path.join(getItemsDir(root), backupId))
        ) {
          backupId = generateItemId(new Date());
        }
        const backupBasename = path.basename(destPath);
        const backupRel = path.posix.join("items", backupId, backupBasename);
        const backupDest = path.join(root, "items", backupId, backupBasename);
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
          reason: `Overwrite backup before restoring ${id}`,
        });
        overwrittenBackupId = backupId;
      }

      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      await moveToTrashLocation(storedPath, destPath);

      const containerDir = path.join(getItemsDir(root), item.id);
      if (fs.existsSync(containerDir)) {
        await safePermanentDelete(containerDir, root);
      }

      manifest.items.splice(idx, 1);
      await writeManifest(root, manifest);

      return {
        item,
        restoredTo: destPath,
        trashRoot: root,
        overwrittenBackupId,
      };
    });
  }

  throw new Error(`Trash item not found: ${id}`);
}

export async function purgeTrash(opts: PurgeOptions): Promise<PurgeResult> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const roots = selectRootsByScope(opts.scope, opts.workspaceRoot, opts.config);
  const maxBytes = opts.config.maxBytes;
  const watermarkBytes = Math.floor(maxBytes * opts.config.watermarkRatio);
  const coolDownMs = opts.config.coolDownHours * 3600_000;

  const allEntries: Array<TrashItem & { trashRoot: string }> = [];
  let totalBytesBefore = 0;
  for (const root of roots) {
    const manifest = readManifest(root);
    for (const item of manifest.items) {
      allEntries.push({ ...item, trashRoot: root });
      totalBytesBefore += item.sizeBytes;
    }
  }

  const isExplicitOverride = Boolean(opts.force || opts.all || opts.ignoreCooldown || opts.id);

  // Explicit human-terminal administration mode
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
          watermarkBytes,
        };
      }
      if (!opts.force) {
        const planned: Array<TrashItem & { trashRoot: string }> = [];
        let running = totalBytesBefore;
        for (const item of candidates) {
          if (running <= watermarkBytes) break;
          planned.push(item);
          running -= item.sizeBytes;
        }
        candidates = planned;
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
        watermarkBytes,
      };
    }

    return await executePurgePlan(candidates, totalBytesBefore, maxBytes, watermarkBytes);
  }

  // Autonomous default mode: strictly gated by quota + cool-down + FIFO watermark.
  if (totalBytesBefore <= maxBytes) {
    return {
      status: "under_quota",
      deleted: [],
      freedBytes: 0,
      totalBytesBefore,
      totalBytesAfter: totalBytesBefore,
      maxBytes,
      watermarkBytes,
    };
  }

  const eligible = allEntries
    .filter((item) => {
      const deletedMs = Date.parse(item.deletedAt);
      return Number.isFinite(deletedMs) && nowMs - deletedMs >= coolDownMs;
    })
    .sort((a, b) => Date.parse(a.deletedAt) - Date.parse(b.deletedAt));

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
      earliestUnlockAt: Number.isFinite(earliestUnlockMs)
        ? new Date(earliestUnlockMs).toISOString()
        : undefined,
    };
  }

  const planned: Array<TrashItem & { trashRoot: string }> = [];
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
      watermarkBytes,
    };
  }

  return await executePurgePlan(planned, totalBytesBefore, maxBytes, watermarkBytes);
}

async function executePurgePlan(
  planned: Array<TrashItem & { trashRoot: string }>,
  totalBytesBefore: number,
  maxBytes: number,
  watermarkBytes: number
): Promise<PurgeResult> {
  const byRoot = new Map<string, Array<TrashItem & { trashRoot: string }>>();
  for (const item of planned) {
    const key = normalizeForCompare(item.trashRoot);
    const group = byRoot.get(key);
    if (group) {
      group.push(item);
    } else {
      byRoot.set(key, [item]);
    }
  }

  const deleted: Array<TrashItem & { trashRoot: string }> = [];
  let freedBytes = 0;

  for (const [, items] of byRoot) {
    const root = items[0].trashRoot;
    await withTrashLock(root, async () => {
      const manifest = readManifest(root);
      const idSet = new Set(items.map((it) => it.id));
      for (const item of items) {
        const containerDir = path.join(getItemsDir(root), item.id);
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
    watermarkBytes,
  };
}

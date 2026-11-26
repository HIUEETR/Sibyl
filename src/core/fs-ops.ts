import fs from "node:fs";
import path from "node:path";
import type { EntryType } from "./manifest.js";
import { isPathInside, normalizeForCompare } from "./paths.js";

export function detectEntryType(stats: fs.Stats): EntryType {
  if (stats.isSymbolicLink()) {
    return "symlink";
  }
  if (stats.isDirectory()) {
    return "dir";
  }
  return "file";
}

export async function calculateSize(targetPath: string): Promise<number> {
  const st = await fs.promises.lstat(targetPath);
  if (st.isSymbolicLink()) {
    return st.size;
  }
  if (!st.isDirectory()) {
    return st.size;
  }
  let total = 0;
  const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    total += await calculateSize(path.join(targetPath, entry.name));
  }
  return total;
}

async function clearReadOnlyRecursive(targetPath: string): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }
  const st = await fs.promises.lstat(targetPath);
  if (st.isSymbolicLink()) {
    return;
  }
  try {
    await fs.promises.chmod(targetPath, st.mode | 0o200);
  } catch {
    // ignore best effort
  }
  if (st.isDirectory()) {
    const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      await clearReadOnlyRecursive(path.join(targetPath, entry.name));
    }
  }
}

async function copySymlinkSafe(srcPath: string, destPath: string): Promise<void> {
  const linkTarget = await fs.promises.readlink(srcPath);
  try {
    await fs.promises.symlink(linkTarget, destPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && (code === "EPERM" || code === "EISDIR")) {
      const resolvedTarget = path.resolve(path.dirname(srcPath), linkTarget);
      await fs.promises.symlink(resolvedTarget, destPath, "junction");
      return;
    }
    throw err;
  }
}

async function copyTreeSafe(srcDir: string, destDir: string): Promise<number> {
  await fs.promises.mkdir(destDir, { recursive: true });
  let count = 1;
  const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcChild = path.join(srcDir, entry.name);
    const destChild = path.join(destDir, entry.name);
    const st = await fs.promises.lstat(srcChild);
    if (st.isSymbolicLink()) {
      await copySymlinkSafe(srcChild, destChild);
      count += 1;
    } else if (st.isDirectory()) {
      count += await copyTreeSafe(srcChild, destChild);
    } else {
      await fs.promises.copyFile(srcChild, destChild);
      const destSt = await fs.promises.lstat(destChild);
      if (destSt.size !== st.size) {
        throw new Error(`Cross-device copy size mismatch for ${srcChild}`);
      }
      count += 1;
    }
  }
  return count;
}

async function countTreeEntries(dir: string): Promise<number> {
  let count = 1;
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    const st = await fs.promises.lstat(child);
    if (st.isDirectory() && !st.isSymbolicLink()) {
      count += await countTreeEntries(child);
    } else {
      count += 1;
    }
  }
  return count;
}

export async function removeSourceSafe(srcPath: string): Promise<void> {
  const st = await fs.promises.lstat(srcPath);
  if (st.isSymbolicLink()) {
    try {
      await fs.promises.unlink(srcPath);
    } catch (err) {
      if (process.platform === "win32" && (err as NodeJS.ErrnoException).code === "EPERM") {
        await fs.promises.rmdir(srcPath);
      } else {
        throw err;
      }
    }
    return;
  }
  try {
    await fs.promises.rm(srcPath, { recursive: true, force: true });
  } catch (err) {
    if (process.platform === "win32") {
      await clearReadOnlyRecursive(srcPath);
      await fs.promises.rm(srcPath, { recursive: true, force: true });
      return;
    }
    throw err;
  }
}

export async function moveToTrashLocation(srcPath: string, destPath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const srcStats = await fs.promises.lstat(srcPath);

  try {
    await fs.promises.rename(srcPath, destPath);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") {
      throw err;
    }
  }

  // Cross-device / cross-drive fallback preserving symlinks without dereferencing.
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

  await fs.promises.copyFile(srcPath, destPath);
  const destStats = await fs.promises.lstat(destPath);
  if (destStats.size !== srcStats.size) {
    throw new Error(`Cross-device file verification mismatch for ${srcPath}`);
  }
  await removeSourceSafe(srcPath);
}

export async function safePermanentDelete(targetPath: string, trashRoot: string): Promise<void> {
  const itemsDir = path.join(trashRoot, "items");
  if (
    !isPathInside(targetPath, itemsDir) ||
    normalizeForCompare(targetPath) === normalizeForCompare(itemsDir)
  ) {
    throw new Error(
      `Refusing permanent delete outside trash items boundary: ${targetPath} (itemsDir: ${itemsDir})`
    );
  }
  if (!fs.existsSync(targetPath)) {
    return;
  }
  await removeSourceSafe(targetPath);
}

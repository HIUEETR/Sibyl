import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type EntryType = "file" | "dir" | "symlink";

export interface TrashItem {
  id: string;
  originalPath: string;
  storedRelPath: string;
  basename: string;
  entryType: EntryType;
  sizeBytes: number;
  deletedAt: string;
  workspace?: string;
  sessionId?: string;
  reason?: string;
  sourceCommand?: string;
}

export interface TrashManifest {
  version: 1;
  items: TrashItem[];
}

const MANIFEST_FILENAME = "manifest.json";
const LOCK_FILENAME = ".lock";
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 5_000;

export function getItemsDir(trashRoot: string): string {
  return path.join(trashRoot, "items");
}

export function getManifestPath(trashRoot: string): string {
  return path.join(trashRoot, MANIFEST_FILENAME);
}

export function ensureTrashRoot(trashRoot: string): void {
  fs.mkdirSync(trashRoot, { recursive: true });
  fs.mkdirSync(getItemsDir(trashRoot), { recursive: true });
  const gitignorePath = path.join(trashRoot, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, "*\n", "utf8");
  }
}

export function generateItemId(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const datePart = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const timePart = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const hex = crypto.randomBytes(3).toString("hex");
  return `${datePart}-${timePart}-${hex}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTrashLock<T>(trashRoot: string, fn: () => Promise<T>): Promise<T> {
  ensureTrashRoot(trashRoot);
  const lockPath = path.join(trashRoot, LOCK_FILENAME);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd: number | undefined;

  while (true) {
    try {
      fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }), "utf8");
      fs.closeSync(fd);
      fd = undefined;
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // Lock released concurrently; retry immediately.
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
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }
    } catch {
      // Best-effort cleanup
    }
  }
}

export function readManifest(trashRoot: string): TrashManifest {
  const manifestPath = getManifestPath(trashRoot);
  if (!fs.existsSync(manifestPath)) {
    return { version: 1, items: [] };
  }
  const raw = fs.readFileSync(manifestPath, "utf8");
  if (!raw.trim()) {
    return { version: 1, items: [] };
  }
  const parsed = JSON.parse(raw) as Partial<TrashManifest>;
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error(`Corrupt Sibyl manifest at ${manifestPath}`);
  }
  return {
    version: 1,
    items: parsed.items,
  };
}

export async function writeManifest(trashRoot: string, manifest: TrashManifest): Promise<void> {
  ensureTrashRoot(trashRoot);
  const manifestPath = getManifestPath(trashRoot);
  const tmpPath = path.join(
    trashRoot,
    `${MANIFEST_FILENAME}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`
  );
  const content = JSON.stringify({ version: 1, items: manifest.items }, null, 2) + "\n";
  await fs.promises.writeFile(tmpPath, content, "utf8");

  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.promises.rename(tmpPath, manifestPath);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
        await sleep(20 * (attempt + 1));
        continue;
      }
      break;
    }
  }
  try {
    await fs.promises.unlink(tmpPath);
  } catch {
    // ignore
  }
  throw lastErr;
}

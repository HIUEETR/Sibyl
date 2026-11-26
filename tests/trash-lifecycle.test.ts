import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig, type SibylConfig } from "../src/core/config.js";
import { readManifest, writeManifest } from "../src/core/manifest.js";
import {
  getStatus,
  listItems,
  purgeTrash,
  restoreItem,
  trashPaths,
} from "../src/core/trash-service.js";

describe("trash lifecycle, symlink safety, and purge guardrails", () => {
  let tmpRoot: string;
  let workspaceRoot: string;
  let sibylHome: string;
  const origSibylHome = process.env.SIBYL_HOME;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sibyl-trash-"));
    workspaceRoot = path.join(tmpRoot, "workspace");
    sibylHome = path.join(tmpRoot, "sibyl-home");
    fs.mkdirSync(workspaceRoot, { recursive: true });
    process.env.SIBYL_HOME = sibylHome;
  });

  afterEach(() => {
    if (origSibylHome === undefined) {
      delete process.env.SIBYL_HOME;
    } else {
      process.env.SIBYL_HOME = origSibylHome;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("trashes files, nested dirs, and colliding basenames while creating internal .gitignore", async () => {
    const dirA = path.join(workspaceRoot, "a");
    const dirB = path.join(workspaceRoot, "b");
    const nested = path.join(workspaceRoot, "nested");
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    fs.mkdirSync(path.join(nested, "sub"), { recursive: true });

    fs.writeFileSync(path.join(dirA, "dup.txt"), "from-a", "utf8");
    fs.writeFileSync(path.join(dirB, "dup.txt"), "from-b", "utf8");
    fs.writeFileSync(path.join(nested, "sub", "data.bin"), "1234567890", "utf8");

    const config = loadConfig(workspaceRoot);
    const res = await trashPaths(["a/dup.txt", "b/dup.txt", "nested"], {
      cwd: workspaceRoot,
      workspaceRoot,
      config,
      reason: "test collision",
    });

    expect(res.moved).toHaveLength(3);
    expect(new Set(res.moved.map((m) => m.id)).size).toBe(3);
    expect(fs.existsSync(path.join(dirA, "dup.txt"))).toBe(false);
    expect(fs.existsSync(path.join(dirB, "dup.txt"))).toBe(false);
    expect(fs.existsSync(path.join(nested))).toBe(false);

    // Internal .gitignore created, root .gitignore untouched
    const trashGitignore = path.join(workspaceRoot, ".sibyl-trash", ".gitignore");
    expect(fs.readFileSync(trashGitignore, "utf8")).toBe("*\n");
    expect(fs.existsSync(path.join(workspaceRoot, ".gitignore"))).toBe(false);

    // Restore one colliding file and verify overwrite protection
    const idA = res.moved[0].id;
    const restored = await restoreItem(idA, {
      cwd: workspaceRoot,
      workspaceRoot,
      config,
    });
    expect(fs.readFileSync(restored.restoredTo, "utf8")).toBe("from-a");

    const idB = res.moved[1].id;
    await expect(
      restoreItem(idB, {
        to: "a/dup.txt",
        cwd: workspaceRoot,
        workspaceRoot,
        config,
      })
    ).rejects.toThrow(/already exists/i);

    const restoredAlt = await restoreItem(idB, {
      to: "restored-b.txt",
      cwd: workspaceRoot,
      workspaceRoot,
      config,
    });
    expect(fs.readFileSync(restoredAlt.restoredTo, "utf8")).toBe("from-b");
  });

  it("moves symlinks/junctions safely without touching their targets", async () => {
    const targetDir = path.join(workspaceRoot, "real-dir");
    fs.mkdirSync(targetDir, { recursive: true });
    const targetFile = path.join(targetDir, "precious.txt");
    fs.writeFileSync(targetFile, "keep-me-intact", "utf8");

    const linkPath = path.join(workspaceRoot, "link-to-dir");
    fs.symlinkSync(targetDir, linkPath, process.platform === "win32" ? "junction" : "dir");

    const config = loadConfig(workspaceRoot);
    const res = await trashPaths(["link-to-dir"], {
      cwd: workspaceRoot,
      workspaceRoot,
      config,
    });

    expect(res.moved[0].entryType).toBe("symlink");
    expect(fs.existsSync(linkPath)).toBe(false);
    expect(fs.readFileSync(targetFile, "utf8")).toBe("keep-me-intact");
  });

  it("routes out-of-workspace files to workspace trash by default and supports global override", async () => {
    const outsideFile = path.join(tmpRoot, "outside.txt");
    fs.writeFileSync(outsideFile, "outside-content", "utf8");

    const config = loadConfig(workspaceRoot);
    const res = await trashPaths([outsideFile], {
      cwd: workspaceRoot,
      workspaceRoot,
      config,
    });

    expect(res.moved[0].trashRoot).toBe(path.join(workspaceRoot, ".sibyl-trash"));
    expect(fs.existsSync(outsideFile)).toBe(false);

    const listed = listItems({ scope: "workspace", workspaceRoot, config });
    expect(listed).toHaveLength(1);
    expect(listed[0].originalPath).toBe(outsideFile);

    const restored = await restoreItem(res.moved[0].id, {
      cwd: workspaceRoot,
      workspaceRoot,
      config,
    });
    expect(restored.restoredTo).toBe(outsideFile);
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside-content");

    const globalConfig: SibylConfig = { ...config, trashMode: "global" };
    const globalRes = await trashPaths([outsideFile], {
      cwd: workspaceRoot,
      workspaceRoot,
      config: globalConfig,
    });
    expect(globalRes.moved[0].trashRoot).toBe(path.join(sibylHome, "trash"));
    expect(fs.existsSync(outsideFile)).toBe(false);
  });

  it("enforces quota + 24h cooldown + FIFO 50% watermark on autonomous purge", async () => {
    const config: SibylConfig = {
      ...DEFAULT_CONFIG,
      maxBytes: 1000,
      watermarkRatio: 0.5, // 500 bytes target
      coolDownHours: 24,
    };

    const makeFile = (name: string, bytes: number) => {
      const p = path.join(workspaceRoot, name);
      fs.writeFileSync(p, Buffer.alloc(bytes, "x"));
      return p;
    };

    // 1. Under quota (400 <= 1000)
    makeFile("f1.bin", 400);
    await trashPaths(["f1.bin"], { cwd: workspaceRoot, workspaceRoot, config });
    const under = await purgeTrash({ scope: "workspace", workspaceRoot, config });
    expect(under.status).toBe("under_quota");
    expect(under.deleted).toHaveLength(0);

    // 2. Exceed quota with recent files (400 + 400 + 400 = 1200 > 1000), all in cooldown
    makeFile("f2.bin", 400);
    makeFile("f3.bin", 400);
    await trashPaths(["f2.bin"], { cwd: workspaceRoot, workspaceRoot, config });
    await trashPaths(["f3.bin"], { cwd: workspaceRoot, workspaceRoot, config });

    const inCooldown = await purgeTrash({ scope: "workspace", workspaceRoot, config });
    expect(inCooldown.status).toBe("all_in_cooldown");
    expect(inCooldown.deleted).toHaveLength(0);
    expect(inCooldown.earliestUnlockAt).toBeDefined();

    // 3. Backdate f1 (oldest, 30h ago) and f2 (26h ago), keep f3 recent (1h ago)
    const wsTrash = path.join(workspaceRoot, ".sibyl-trash");
    const manifest = readManifest(wsTrash);
    const now = Date.now();
    manifest.items[0].deletedAt = new Date(now - 30 * 3600_000).toISOString();
    manifest.items[1].deletedAt = new Date(now - 26 * 3600_000).toISOString();
    manifest.items[2].deletedAt = new Date(now - 1 * 3600_000).toISOString();
    await writeManifest(wsTrash, manifest);

    const status = getStatus({ scope: "workspace", workspaceRoot, config, now: new Date(now) });
    expect(status.quotaExceeded).toBe(true);
    expect(status.canPurge).toBe(true);
    expect(status.watermarkBytes).toBe(500);
    expect(status.purgeableCount).toBe(2);
    expect(status.protectedCount).toBe(1);

    // Dry run plans FIFO deletion of f1 and f2 (1200 -> 800 -> 400 <= 500)
    const dry = await purgeTrash({
      scope: "workspace",
      workspaceRoot,
      config,
      dryRun: true,
      now: new Date(now),
    });
    expect(dry.status).toBe("dry_run");
    expect(dry.deleted.map((d) => d.basename)).toEqual(["f1.bin", "f2.bin"]);
    expect(dry.totalBytesAfter).toBe(400);

    // Real purge deletes only expired FIFO items down to <= 50% watermark
    const purged = await purgeTrash({
      scope: "workspace",
      workspaceRoot,
      config,
      now: new Date(now),
    });
    expect(purged.status).toBe("purged");
    expect(purged.deleted.map((d) => d.basename)).toEqual(["f1.bin", "f2.bin"]);
    expect(purged.totalBytesAfter).toBe(400);

    const remaining = listItems({ scope: "workspace", workspaceRoot, config });
    expect(remaining.map((r) => r.basename)).toEqual(["f3.bin"]);
  });
});

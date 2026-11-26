import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type SibylConfig } from "../src/core/config.js";
import { evaluateCommand, evaluateFileWrite } from "../src/policy/analyzer.js";

describe("shell parser and policy analyzer", () => {
  let tmpRoot: string;
  let workspaceRoot: string;
  let sibylHome: string;
  let runtimePath: string;
  const origSibylHome = process.env.SIBYL_HOME;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sibyl-policy-"));
    workspaceRoot = path.join(tmpRoot, "workspace");
    sibylHome = path.join(tmpRoot, "sibyl-home");
    runtimePath = path.join(workspaceRoot, ".agents", "skills", "sibyl", "scripts", "sibyl.mjs");
    fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
    fs.writeFileSync(runtimePath, "// runtime", "utf8");
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

  function evalCmd(commandLine: string, overrides?: Partial<SibylConfig>) {
    const config: SibylConfig = { ...DEFAULT_CONFIG, ...overrides };
    return evaluateCommand({
      commandLine,
      cwd: workspaceRoot,
      workspaceRoot,
      config,
      runtimePath,
    });
  }

  it("rewrites simple POSIX, PowerShell, and CMD delete commands to sibyl trash", () => {
    const posix = evalCmd('rm -rf "foo bar.txt" baz');
    expect(posix.action).toBe("rewrite");
    expect(posix.rewrittenCommand).toContain("trash --from-hook");
    expect(posix.rewrittenCommand).toContain('"foo bar.txt"');
    expect(posix.rewrittenCommand).toContain('"baz"');

    const rmdirRes = evalCmd("rmdir old-dir");
    expect(rmdirRes.action).toBe("rewrite");
    expect(rmdirRes.rewrittenCommand).toContain('"old-dir"');

    const unlinkRes = evalCmd("unlink temp.lock");
    expect(unlinkRes.action).toBe("rewrite");

    const psRes = evalCmd("Remove-Item -Recurse -Force build/out");
    expect(psRes.action).toBe("rewrite");
    expect(psRes.rewrittenCommand).toContain('"build/out"');

    const psAlias = evalCmd("ri temp.txt");
    expect(psAlias.action).toBe("rewrite");

    const cmdDel = evalCmd("del /f /q a.txt b.txt");
    expect(cmdDel.action).toBe("rewrite");
    expect(cmdDel.rewrittenCommand).toContain('"a.txt" "b.txt"');

    const cmdRd = evalCmd("rd /s /q cache");
    expect(cmdRd.action).toBe("rewrite");
    expect(cmdRd.rewrittenCommand).toContain('"cache"');
  });

  it("denies complex, compound, glob, variable, find -delete, and inline script deletes", () => {
    expect(evalCmd("cd sub && rm -rf target").action).toBe("deny");
    expect(evalCmd("rm -rf *.tmp").action).toBe("deny");
    expect(evalCmd("rm -rf $TARGET_DIR").action).toBe("deny");
    expect(evalCmd('find . -name "*.log" -delete').action).toBe("deny");
    expect(evalCmd("git ls-files -z | xargs -0 rm -f").action).toBe("deny");
    expect(evalCmd('python -c "import os; os.remove(\'a.txt\')"').action).toBe("deny");
    expect(evalCmd('node -e "fs.rmSync(\'dist\', { recursive: true })"').action).toBe("deny");
    expect(evalCmd('pwsh -Command "Remove-Item -Recurse -Force dist"').action).toBe("deny");
  });

  it("denies destructive git operations while allowing safe git inspection and staging commands", () => {
    expect(evalCmd("git clean -fd").action).toBe("deny");
    expect(evalCmd("git reset --hard HEAD~1").action).toBe("deny");
    expect(evalCmd("git checkout -- src/index.ts").action).toBe("deny");
    expect(evalCmd("git checkout .").action).toBe("deny");
    expect(evalCmd("git restore src/index.ts").action).toBe("deny");

    expect(evalCmd("git clean -n").action).toBe("allow");
    expect(evalCmd("git status").action).toBe("allow");
    expect(evalCmd("git checkout -b feature/safe").action).toBe("allow");
    expect(evalCmd("git restore --staged src/index.ts").action).toBe("allow");
  });

  it("enforces self-protection on shell commands and file write tools", () => {
    expect(evalCmd("rm -rf .sibyl-trash").action).toBe("deny");
    expect(evalCmd("rm -rf .agents").action).toBe("deny");
    expect(evalCmd("echo '{}' > .sibyl.json").action).toBe("deny");
    expect(evalCmd(`del "${path.join(sibylHome, "config.json")}"`).action).toBe("deny");

    const cfg = { ...DEFAULT_CONFIG };
    expect(
      evaluateFileWrite({
        targetPath: ".sibyl.json",
        cwd: workspaceRoot,
        workspaceRoot,
        config: cfg,
        runtimePath,
      }).action
    ).toBe("deny");

    expect(
      evaluateFileWrite({
        targetPath: ".agents/hooks.json",
        cwd: workspaceRoot,
        workspaceRoot,
        config: cfg,
        runtimePath,
      }).action
    ).toBe("deny");

    expect(
      evaluateFileWrite({
        targetPath: ".claude/settings.json",
        cwd: workspaceRoot,
        workspaceRoot,
        config: cfg,
        runtimePath,
      }).action
    ).toBe("deny");

    expect(
      evaluateFileWrite({
        targetPath: runtimePath,
        cwd: workspaceRoot,
        workspaceRoot,
        config: cfg,
        runtimePath,
      }).action
    ).toBe("deny");

    expect(
      evaluateFileWrite({
        targetPath: "src/app.ts",
        cwd: workspaceRoot,
        workspaceRoot,
        config: cfg,
        runtimePath,
      }).action
    ).toBe("allow");
  });

  it("allows standard autonomous sibyl purge while denying agent bypass flags", () => {
    expect(evalCmd(`node "${runtimePath}" purge`).action).toBe("allow");
    expect(evalCmd(`node "${runtimePath}" purge --dry-run`).action).toBe("allow");
    expect(evalCmd(`node "${runtimePath}" purge --force`).action).toBe("deny");
    expect(evalCmd(`node "${runtimePath}" purge --all`).action).toBe("deny");
    expect(evalCmd(`node "${runtimePath}" purge --ignore-cooldown`).action).toBe("deny");
    expect(evalCmd(`node "${runtimePath}" purge --id 20261126-120000-abcdef`).action).toBe("deny");
    expect(evalCmd(`node "${runtimePath}" status && rm -rf foo`).action).toBe("deny");
  });

  it("supports opt-in direct delete whitelist strictly scoped inside workspace", () => {
    // Disabled by default
    expect(evalCmd("rm -rf node_modules").action).toBe("rewrite");

    // Enabled for node_modules inside workspace only
    expect(
      evalCmd("rm -rf node_modules", { allowDirectDeletePatterns: ["node_modules"] }).action
    ).toBe("allow");

    expect(
      evalCmd("rm -rf ../outside/node_modules", {
        allowDirectDeletePatterns: ["node_modules"],
      }).action
    ).toBe("rewrite");
  });
});

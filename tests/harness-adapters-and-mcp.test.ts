import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const bundlePath = path.join(repoRoot, "skills", "sibyl", "scripts", "sibyl.mjs");

function runBundle(args: string[], opts?: { cwd?: string; input?: string; env?: NodeJS.ProcessEnv }) {
  return spawnSync(process.execPath, [bundlePath, ...args], {
    cwd: opts?.cwd ?? repoRoot,
    input: opts?.input,
    env: { ...process.env, ...opts?.env },
    encoding: "utf8",
  });
}

describe("bundled sibyl.mjs: harness hooks, MCP server, and init installer", () => {
  let tmpRoot: string;
  let workspaceRoot: string;
  let sibylHome: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sibyl-e2e-"));
    workspaceRoot = path.join(tmpRoot, "project");
    sibylHome = path.join(tmpRoot, "sibyl-home");
    fs.mkdirSync(workspaceRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("handles Antigravity SessionStart and PreToolUse hook contracts", () => {
    const env = { SIBYL_HOME: sibylHome };

    const sessionRes = runBundle(["hook"], {
      cwd: workspaceRoot,
      env,
      input: JSON.stringify({
        hookEventName: "SessionStart",
        workspacePaths: [workspaceRoot],
        cwd: workspaceRoot,
      }),
    });
    expect(sessionRes.status).toBe(0);
    const sessionJson = JSON.parse(sessionRes.stdout);
    expect(sessionJson.injectSteps?.[0]?.systemMessage?.systemMessage).toContain("Sibyl");

    const rewriteRes = runBundle(["hook"], {
      cwd: workspaceRoot,
      env,
      input: JSON.stringify({
        hookEventName: "PreToolUse",
        cwd: workspaceRoot,
        workspacePaths: [workspaceRoot],
        toolCall: {
          name: "run_command",
          args: { CommandLine: "rm -rf obsolete.txt" },
        },
      }),
    });
    expect(rewriteRes.status).toBe(0);
    const rewriteJson = JSON.parse(rewriteRes.stdout);
    expect(rewriteJson.decision).toBe("allow");
    expect(rewriteJson.overwrite?.CommandLine).toContain("trash --from-hook");
    expect(rewriteJson.overwrite?.CommandLine).toContain('"obsolete.txt"');

    const denyWriteRes = runBundle(["hook"], {
      cwd: workspaceRoot,
      env,
      input: JSON.stringify({
        hookEventName: "PreToolUse",
        cwd: workspaceRoot,
        workspacePaths: [workspaceRoot],
        toolCall: {
          name: "write_file",
          args: { Path: ".agents/hooks.json" },
        },
      }),
    });
    expect(denyWriteRes.status).toBe(0);
    const denyWriteJson = JSON.parse(denyWriteRes.stdout);
    expect(denyWriteJson.decision).toBe("deny");
  });

  it("handles Claude Code SessionStart and PreToolUse hook contracts", () => {
    const env = { SIBYL_HOME: sibylHome };

    const sessionRes = runBundle(["hook"], {
      cwd: workspaceRoot,
      env,
      input: JSON.stringify({
        hook_event_name: "SessionStart",
        cwd: workspaceRoot,
      }),
    });
    expect(sessionRes.status).toBe(0);
    const sessionJson = JSON.parse(sessionRes.stdout);
    expect(sessionJson.hookSpecificOutput?.hookEventName).toBe("SessionStart");
    expect(sessionJson.hookSpecificOutput?.additionalContext).toContain("Sibyl");

    const rewriteRes = runBundle(["hook"], {
      cwd: workspaceRoot,
      env,
      input: JSON.stringify({
        hook_event_name: "PreToolUse",
        cwd: workspaceRoot,
        tool_name: "Bash",
        tool_input: { command: "rm -rf old.log" },
      }),
    });
    expect(rewriteRes.status).toBe(0);
    const rewriteJson = JSON.parse(rewriteRes.stdout);
    expect(rewriteJson.hookSpecificOutput?.permissionDecision).toBe("allow");
    expect(rewriteJson.hookSpecificOutput?.updatedInput?.command).toContain("trash --from-hook");

    const denyEditRes = runBundle(["hook"], {
      cwd: workspaceRoot,
      env,
      input: JSON.stringify({
        hook_event_name: "PreToolUse",
        cwd: workspaceRoot,
        tool_name: "Edit",
        tool_input: { file_path: ".claude/settings.json" },
      }),
    });
    expect(denyEditRes.status).toBe(0);
    const denyEditJson = JSON.parse(denyEditRes.stdout);
    expect(denyEditJson.hookSpecificOutput?.permissionDecision).toBe("deny");
  });

  it("serves stdio MCP JSON-RPC tools end-to-end without bypass flags on sibyl_purge", async () => {
    const targetFile = path.join(workspaceRoot, "mcp-sample.txt");
    fs.writeFileSync(targetFile, "hello-mcp", "utf8");

    const child = spawn(process.execPath, [bundlePath, "mcp", "--cwd", workspaceRoot], {
      cwd: workspaceRoot,
      env: { ...process.env, SIBYL_HOME: sibylHome },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const responses: Array<Record<string, unknown>> = [];
    let buffer = "";
    const waitForCount = (expected: number) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timed out waiting for ${expected} MCP responses, got ${responses.length}`)),
          5000
        );
        const check = () => {
          if (responses.length >= expected) {
            clearTimeout(timer);
            resolve();
          }
        };
        child.stdout.on("data", (chunk) => {
          buffer += chunk.toString("utf8");
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim()) {
              responses.push(JSON.parse(line));
            }
          }
          check();
        });
        check();
      });

    const send = (obj: unknown) => child.stdin.write(`${JSON.stringify(obj)}\n`);

    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "sibyl_trash", arguments: { paths: ["mcp-sample.txt"], cwd: workspaceRoot } },
    });
    send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "sibyl_status", arguments: { scope: "workspace", cwd: workspaceRoot } },
    });
    send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "sibyl_list", arguments: { scope: "workspace", cwd: workspaceRoot } },
    });
    send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "sibyl_purge", arguments: { scope: "workspace", cwd: workspaceRoot } },
    });

    await waitForCount(6);
    const listResp = responses.find((r) => r.id === 2) as {
      result: { tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }> };
    };
    const toolNames = listResp.result.tools.map((t) => t.name);
    expect(toolNames).toEqual([
      "sibyl_trash",
      "sibyl_status",
      "sibyl_list",
      "sibyl_restore",
      "sibyl_purge",
    ]);
    const purgeProps = listResp.result.tools.find((t) => t.name === "sibyl_purge")!.inputSchema
      .properties;
    expect(purgeProps).not.toHaveProperty("force");
    expect(purgeProps).not.toHaveProperty("all");
    expect(purgeProps).not.toHaveProperty("ignoreCooldown");

    const trashResp = responses.find((r) => r.id === 3) as {
      result: { content: Array<{ text: string }> };
    };
    const trashedPayload = JSON.parse(trashResp.result.content[0].text);
    const trashedId = trashedPayload.moved[0].id as string;
    expect(fs.existsSync(targetFile)).toBe(false);

    const purgeResp = responses.find((r) => r.id === 6) as {
      result: { content: Array<{ text: string }> };
    };
    expect(JSON.parse(purgeResp.result.content[0].text).status).toBe("under_quota");

    // Restore via MCP
    send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "sibyl_restore", arguments: { id: trashedId, cwd: workspaceRoot } },
    });
    await waitForCount(7);
    child.stdin.end();
    await new Promise<void>((resolve) => child.on("close", () => resolve()));

    expect(fs.readFileSync(targetFile, "utf8")).toBe("hello-mcp");
  });

  it("merges hooks and rules idempotently during sibyl init without clobbering existing config", () => {
    fs.mkdirSync(path.join(workspaceRoot, ".agents"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, ".agents", "hooks.json"),
      JSON.stringify({ "existing-hook": { enabled: true, PreToolUse: [] } }, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspaceRoot, ".claude", "settings.json"),
      JSON.stringify(
        {
          permissions: { allow: ["Read"] },
          hooks: {
            PreToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: "echo ok" }] }],
          },
        },
        null,
        2
      ),
      "utf8"
    );
    fs.writeFileSync(path.join(workspaceRoot, "AGENTS.md"), "# Team Rules\n", "utf8");

    execFileSync(
      process.execPath,
      [bundlePath, "init", "--target", "all", "--scope", "workspace"],
      { cwd: workspaceRoot, env: { ...process.env, SIBYL_HOME: sibylHome } }
    );
    // Run a second time to verify idempotency
    execFileSync(
      process.execPath,
      [bundlePath, "init", "--target", "all", "--scope", "workspace"],
      { cwd: workspaceRoot, env: { ...process.env, SIBYL_HOME: sibylHome } }
    );

    const agyHooks = JSON.parse(
      fs.readFileSync(path.join(workspaceRoot, ".agents", "hooks.json"), "utf8")
    );
    expect(agyHooks["existing-hook"]).toBeDefined();
    expect(agyHooks["sibyl-guard"]).toBeDefined();

    const claudeSettings = JSON.parse(
      fs.readFileSync(path.join(workspaceRoot, ".claude", "settings.json"), "utf8")
    );
    expect(claudeSettings.permissions).toEqual({ allow: ["Read"] });
    expect(claudeSettings.hooks.PreToolUse).toHaveLength(2);
    expect(claudeSettings.hooks.SessionStart).toHaveLength(1);

    const agentsMd = fs.readFileSync(path.join(workspaceRoot, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("# Team Rules");
    expect(agentsMd.match(/<!-- sibyl:begin -->/g)).toHaveLength(1);
    expect(fs.existsSync(path.join(workspaceRoot, ".agents", "skills", "sibyl", "SKILL.md"))).toBe(
      true
    );
    expect(
      fs.existsSync(path.join(workspaceRoot, ".claude", "skills", "sibyl", "scripts", "sibyl.mjs"))
    ).toBe(true);
  });
});

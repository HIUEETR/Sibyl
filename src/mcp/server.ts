import readline from "node:readline";
import { loadConfig } from "../core/config.js";
import { resolveWorkspaceRoot } from "../core/paths.js";
import {
  getStatus,
  listItems,
  purgeTrash,
  restoreItem,
  trashPaths,
  type TrashScope,
} from "../core/trash-service.js";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const MCP_TOOLS = [
  {
    name: "sibyl_trash",
    description:
      "Safely move files, directories, or symlinks into the Sibyl trash instead of permanently deleting them.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "File or directory paths to move to trash.",
        },
        reason: {
          type: "string",
          description: "Optional reason for trashing these items.",
        },
        cwd: {
          type: "string",
          description: "Working directory to resolve relative paths from.",
        },
      },
      required: ["paths"],
    },
  },
  {
    name: "sibyl_status",
    description:
      "Query Sibyl trash size, quota usage, cool-down protected bytes, and whether autonomous purge is unlocked.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["workspace", "global", "all"],
          description: "Trash scope to inspect (default: all).",
        },
        cwd: {
          type: "string",
          description: "Working directory for workspace resolution.",
        },
      },
    },
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
          description: "Trash scope to list (default: all).",
        },
        limit: {
          type: "number",
          description: "Maximum number of newest items to return.",
        },
        cwd: {
          type: "string",
          description: "Working directory for workspace resolution.",
        },
      },
    },
  },
  {
    name: "sibyl_restore",
    description: "Restore a trashed item by its ID back to its original path or a custom destination.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Trash item ID from sibyl_list or sibyl_trash.",
        },
        to: {
          type: "string",
          description: "Optional alternative destination path.",
        },
        overwrite: {
          type: "boolean",
          description: "If destination exists, back it up into trash before restoring.",
        },
        cwd: {
          type: "string",
          description: "Working directory for resolving relative --to path and workspace.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "sibyl_purge",
    description:
      "Autonomously purge expired trash items FIFO down to the safety watermark ONLY when quota is exceeded and items have passed the cool-down period.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["workspace", "global", "all"],
          description: "Trash scope to purge (default: all).",
        },
        dryRun: {
          type: "boolean",
          description: "Preview planned deletions without removing files.",
        },
        cwd: {
          type: "string",
          description: "Working directory for workspace resolution.",
        },
      },
    },
  },
];

function writeJsonLine(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function sendResult(id: string | number | null, result: unknown): void {
  writeJsonLine({ jsonrpc: "2.0", id, result });
}

function sendError(id: string | number | null, code: number, message: string): void {
  writeJsonLine({ jsonrpc: "2.0", id, error: { code, message } });
}

function asScope(val: unknown): TrashScope {
  if (val === "workspace" || val === "global" || val === "all") {
    return val;
  }
  return "all";
}

async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  defaultWorkspace: string
): Promise<unknown> {
  const cwd = typeof args.cwd === "string" && args.cwd.trim() ? args.cwd : defaultWorkspace;
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const config = loadConfig(workspaceRoot);

  switch (name) {
    case "sibyl_trash": {
      const paths = Array.isArray(args.paths)
        ? args.paths.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        : [];
      if (paths.length === 0) {
        throw new Error("sibyl_trash requires a non-empty `paths` string array.");
      }
      const reason = typeof args.reason === "string" ? args.reason : undefined;
      return await trashPaths(paths, { cwd, workspaceRoot, config, reason });
    }
    case "sibyl_status": {
      return getStatus({ scope: asScope(args.scope), workspaceRoot, config });
    }
    case "sibyl_list": {
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      return listItems({ scope: asScope(args.scope), workspaceRoot, config, limit });
    }
    case "sibyl_restore": {
      const id = typeof args.id === "string" ? args.id.trim() : "";
      if (!id) {
        throw new Error("sibyl_restore requires `id`.");
      }
      const to = typeof args.to === "string" ? args.to : undefined;
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
        dryRun,
      });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function startMcpServer(defaultWorkspace = process.cwd()): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      sendError(null, -32700, "Parse error");
      continue;
    }

    const hasId = req.id !== undefined && req.id !== null;
    const reqId = req.id ?? null;

    if (req.method === "notifications/initialized" || req.method === "notifications/cancelled") {
      continue;
    }

    if (req.method === "initialize") {
      const protocolVersion =
        typeof req.params?.protocolVersion === "string"
          ? req.params.protocolVersion
          : "2024-11-05";
      if (hasId) {
        sendResult(reqId, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "sibyl", version: "0.1.0" },
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
      const toolArgs =
        req.params?.arguments && typeof req.params.arguments === "object"
          ? (req.params.arguments as Record<string, unknown>)
          : {};
      try {
        const result = await callMcpTool(toolName, toolArgs, defaultWorkspace);
        if (hasId) {
          sendResult(reqId, {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: false,
          });
        }
      } catch (err) {
        if (hasId) {
          sendResult(reqId, {
            content: [{ type: "text", text: (err as Error).message }],
            isError: true,
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

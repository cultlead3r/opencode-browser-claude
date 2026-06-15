#!/usr/bin/env node
/**
 * opencode-browser -> Claude Code MCP bridge
 * ------------------------------------------
 * A zero-dependency MCP (Model Context Protocol) stdio server that exposes the
 * `@different-ai/opencode-browser` plugin's `browser_*` tools to Claude Code.
 *
 * How it works:
 *   Claude Code  <--MCP/stdio-->  THIS SERVER  --(imports)-->  opencode-browser plugin bundle
 *                                                              --(unix socket)--> broker
 *                                                              --> native host --> Chrome/Brave extension
 *
 * The plugin bundle (dist/plugin.js) is reused verbatim: we call its exported
 * `plugin({})` factory to obtain the tool map and invoke `tool.execute(args, {})`
 * exactly like the upstream `tool-test.ts` / CLI do. The broker, native host and
 * browser extension are untouched and shared with any OpenCode sessions.
 *
 * Nothing is ever written to stdout except newline-delimited JSON-RPC messages;
 * all diagnostics go to ~/.opencode-browser/claude-mcp.log.
 */

import {
  readdirSync,
  existsSync,
  statSync,
  appendFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const BRIDGE_VERSION = "1.0.0";
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const LOG_PATH = join(HOME, ".opencode-browser", "claude-mcp.log");

function log(msg) {
  try {
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`, "utf8");
  } catch {
    /* logging must never throw */
  }
}

/* ------------------------------------------------------------------ *
 * 1. Locate the installed opencode-browser plugin bundle (dist/plugin.js)
 * ------------------------------------------------------------------ */
function mtimeOrZero(p) {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function listDirSafe(p) {
  try {
    return readdirSync(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

function collectCandidates() {
  const candidates = [];
  const add = (p) => {
    if (p && existsSync(p)) candidates.push(p);
  };

  const INNER = join(
    "node_modules",
    "@different-ai",
    "opencode-browser",
    "dist",
    "plugin.js",
  );

  // opencode package cache:
  //   ~/.cache/opencode/packages/@different-ai/opencode-browser@<ver>/<INNER>
  const ocScope = join(HOME, ".cache", "opencode", "packages", "@different-ai");
  for (const e of listDirSafe(ocScope)) {
    if (e.isDirectory() && e.name.startsWith("opencode-browser@")) {
      add(join(ocScope, e.name, INNER));
    }
  }

  // npx cache: ~/.npm/_npx/<hash>/<INNER>
  const npxRoot = join(HOME, ".npm", "_npx");
  for (const e of listDirSafe(npxRoot)) {
    if (e.isDirectory()) add(join(npxRoot, e.name, INNER));
  }

  // bun cache: ~/.bun/install/cache/@different-ai/opencode-browser@<ver>@@@N/dist/plugin.js
  const bunScope = join(
    HOME,
    ".bun",
    "install",
    "cache",
    "@different-ai",
  );
  for (const e of listDirSafe(bunScope)) {
    if (e.isDirectory() && e.name.startsWith("opencode-browser@")) {
      add(join(bunScope, e.name, "dist", "plugin.js"));
    }
  }

  return candidates;
}

function resolvePluginPath() {
  // 1. Explicit override always wins.
  const override = process.env.OPENCODE_BROWSER_PLUGIN_PATH;
  if (override && existsSync(override)) {
    log(`using plugin from OPENCODE_BROWSER_PLUGIN_PATH=${override}`);
    return override;
  }

  // 2. Newest installed copy from known caches.
  const candidates = collectCandidates();
  if (candidates.length) {
    candidates.sort((a, b) => mtimeOrZero(b) - mtimeOrZero(a));
    log(`resolved plugin (newest of ${candidates.length}) -> ${candidates[0]}`);
    return candidates[0];
  }

  // 3. Vendored fallback shipped next to this server.
  const vendored = join(__dirname, "vendor", "plugin.js");
  if (existsSync(vendored)) {
    log(`using vendored plugin -> ${vendored}`);
    return vendored;
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * 2. Convert the plugin's Zod arg maps into JSON Schema for MCP
 * ------------------------------------------------------------------ */
function unwrap(zt) {
  const WRAPPERS = new Set([
    "optional",
    "default",
    "nullable",
    "nonoptional",
    "readonly",
    "catch",
    "prefault",
  ]);
  let t = zt;
  const seen = new Set();
  while (t && t.def && WRAPPERS.has(t.def.type)) {
    const inner = t.def.innerType ?? t.def.inner ?? null;
    if (!inner || seen.has(inner)) break;
    seen.add(inner);
    t = inner;
  }
  return t;
}

function zodToJsonType(zt) {
  const t = unwrap(zt);
  const base = t && t.def ? t.def.type : undefined;
  switch (base) {
    case "string":
      return { type: "string" };
    case "number":
    case "float":
      return { type: "number" };
    case "int":
    case "bigint":
      return { type: "integer" };
    case "boolean":
      return { type: "boolean" };
    case "array":
      return { type: "array" };
    case "object":
      return { type: "object" };
    default:
      // Safe permissive fallback for unknown/new types.
      return {};
  }
}

function buildInputSchema(args) {
  const properties = {};
  const required = [];
  for (const [key, zt] of Object.entries(args || {})) {
    properties[key] = zodToJsonType(zt);
    let optional = false;
    try {
      optional =
        typeof zt?.isOptional === "function" ? !!zt.isOptional() : false;
    } catch {
      optional = false;
    }
    if (!optional) required.push(key);
  }
  const schema = { type: "object", properties };
  if (required.length) schema.required = required;
  return schema;
}

/* ------------------------------------------------------------------ *
 * 3. Load the plugin and build the tool registry
 * ------------------------------------------------------------------ */
let toolMap = {};
let toolList = [];

async function loadTools() {
  const pluginPath = resolvePluginPath();
  if (!pluginPath) {
    log(
      "FATAL: could not locate @different-ai/opencode-browser dist/plugin.js. " +
        "Install it (`bunx @different-ai/opencode-browser@latest install`) or set " +
        "OPENCODE_BROWSER_PLUGIN_PATH.",
    );
    return;
  }
  try {
    const mod = await import(pathToFileURL(pluginPath).href);
    const plugin = mod.default || mod.plugin || mod;
    const instance = await plugin({});
    toolMap = instance?.tool || {};
    toolList = Object.entries(toolMap).map(([name, def]) => ({
      name,
      description: def?.description || "",
      inputSchema: buildInputSchema(def?.args),
    }));
    log(`loaded ${toolList.length} tools from ${pluginPath}`);
  } catch (err) {
    log(`FATAL: failed to load plugin from ${pluginPath}: ${err?.stack || err}`);
  }
}

/* ------------------------------------------------------------------ *
 * 4. Minimal MCP (JSON-RPC 2.0 over newline-delimited stdio)
 * ------------------------------------------------------------------ */
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

let inFlight = 0;
let stdinEnded = false;
function maybeExit() {
  if (stdinEnded && inFlight === 0) process.exit(0);
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize": {
      reply(id, {
        protocolVersion: params?.protocolVersion || DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "opencode-browser", version: BRIDGE_VERSION },
      });
      return;
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return; // notifications: no response

    case "ping":
      if (!isNotification) reply(id, {});
      return;

    case "tools/list":
      reply(id, { tools: toolList });
      return;

    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments || {};
      const tool = toolMap[name];
      if (!tool || typeof tool.execute !== "function") {
        // Surface as a tool error (per MCP spec) rather than a protocol error.
        reply(id, {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        });
        return;
      }
      inFlight++;
      try {
        const result = await tool.execute(args, {});
        const text =
          typeof result === "string"
            ? result
            : JSON.stringify(result ?? null);
        reply(id, { content: [{ type: "text", text }] });
      } catch (err) {
        log(`tool ${name} error: ${err?.stack || err}`);
        reply(id, {
          content: [
            { type: "text", text: `Error: ${err?.message || String(err)}` },
          ],
          isError: true,
        });
      } finally {
        inFlight--;
        maybeExit();
      }
      return;
    }

    default:
      if (!isNotification) {
        replyError(id, -32601, `Method not found: ${method}`);
      }
      return;
  }
}

/* ------------------------------------------------------------------ *
 * 5. Wire up stdio
 * ------------------------------------------------------------------ */
async function main() {
  const argv = process.argv.slice(2);

  // Diagnostic CLI modes (do NOT start the MCP server; safe to print to stdout).
  if (argv.includes("--check") || argv.includes("--tools")) {
    const pluginPath = resolvePluginPath();
    if (!pluginPath) {
      console.error(
        "[opencode-browser-claude] FAILED to locate @different-ai/opencode-browser.\n" +
          "  Install it first:  bunx @different-ai/opencode-browser@latest install\n" +
          "  Or set OPENCODE_BROWSER_PLUGIN_PATH to its dist/plugin.js",
      );
      process.exit(1);
    }
    await loadTools();
    if (!toolList.length) {
      console.error(
        `[opencode-browser-claude] Loaded plugin but found no tools (path: ${pluginPath}).`,
      );
      process.exit(1);
    }
    console.log("[opencode-browser-claude] OK");
    console.log(`  bridge version: ${BRIDGE_VERSION}`);
    console.log(`  plugin: ${pluginPath}`);
    console.log(
      `  tools (${toolList.length}): ${toolList.map((t) => t.name).join(", ")}`,
    );
    process.exit(0);
  }

  await loadTools();

  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        log(`could not parse line: ${trimmed.slice(0, 200)}`);
        continue;
      }
      // handle async, but keep ordering best-effort
      handleMessage(msg).catch((e) =>
        log(`handler error: ${e?.stack || e}`),
      );
    }
  });
  // When the client closes stdin, drain any in-flight tool calls before exiting
  // (avoids dropping a response if stdin is half-closed mid-request).
  const onStdinDone = () => {
    stdinEnded = true;
    if (inFlight === 0) {
      process.exit(0);
    } else {
      // Safety net: never hang past the broker's own 60s timeout.
      const t = setTimeout(() => process.exit(0), 65000);
      if (typeof t.unref === "function") t.unref();
    }
  };
  process.stdin.on("end", onStdinDone);
  process.stdin.on("close", onStdinDone);

  log(`bridge v${BRIDGE_VERSION} started (pid ${process.pid})`);
}

main().catch((e) => {
  log(`fatal main error: ${e?.stack || e}`);
  process.exit(1);
});

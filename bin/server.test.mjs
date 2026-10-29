import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

test("MCP screenshots are images; text and error responses remain compatible", async () => {
  const dir = await mkdtemp(join(tmpdir(), "browser-mcp-test-"));
  const pluginPath = join(dir, "plugin.mjs");
  // A real one-pixel PNG exercises the extension's data-URL response format.
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=";
  let child;
  try {
    await writeFile(pluginPath, `export default async () => ({ tool: {
      browser_screenshot: { args: {}, async execute(args) {
        if (args.fail) throw new Error("Debugger unavailable");
        return args.invalid ? "Screenshot failed" : "data:image/png;base64,${png}";
      } },
      browser_click: { args: {}, async execute() { return "Clicked button (trusted)"; } },
      browser_open_tab: { args: {}, async execute() {
        throw new Error("Chrome extension is not connected (native host offline)");
      } }
    } });`);
    child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], {
      env: { ...process.env, OPENCODE_BROWSER_PLUGIN_PATH: pluginPath },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    const closed = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    const timer = setTimeout(() => child.kill(), 10000);
    try {
      const messages = [
        { id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
        { method: "notifications/initialized" },
        { id: 2, method: "tools/list" },
        { id: 3, method: "tools/call", params: { name: "browser_screenshot" } },
        { id: 4, method: "tools/call", params: { name: "browser_click" } },
        { id: 5, method: "tools/call", params: { name: "browser_screenshot", arguments: { invalid: true } } },
        { id: 6, method: "tools/call", params: { name: "browser_screenshot", arguments: { fail: true } } },
        { id: 7, method: "tools/call", params: { name: "browser_open_tab" } },
      ];
      child.stdin.end(messages.map(message => JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n").join(""));
      assert.equal(await closed, 0, stderr);
    } finally {
      clearTimeout(timer);
    }
    const responses = new Map(output.trim().split("\n").map(line => {
      const response = JSON.parse(line);
      return [response.id, response.result];
    }));
    assert.equal(responses.size, 7);
    assert.equal(responses.get(1).protocolVersion, "2025-06-18");
    assert.equal(responses.get(2).tools.length, 3);
    assert.deepEqual(responses.get(3), { content: [{ type: "image", mimeType: "image/png", data: png }] });
    assert.deepEqual(responses.get(4), { content: [{ type: "text", text: "Clicked button (trusted)" }] });
    for (const id of [5, 6]) {
      assert.equal(responses.get(id).isError, true);
      assert.equal(responses.get(id).content[0].type, "text");
    }
    assert.match(responses.get(5).content[0].text, /valid image data URL/);
    assert.match(responses.get(6).content[0].text, /Debugger unavailable/);
    assert.equal(responses.get(7).isError, true);
    assert.match(responses.get(7).content[0].text, /native host offline\) The browser extension isn't running/);
  } finally {
    if (child && child.exitCode === null) child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

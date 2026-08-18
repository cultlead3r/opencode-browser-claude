# opencode-browser-claude

The Claude for Chrome plugin constantly demands permission. There's no simple way to avoid it, so this makes OpenCode's equivalent browser automation plugin work with Claude Code. Slop instructions below.


Use the excellent [`@different-ai/opencode-browser`](https://github.com/different-ai/opencode-browser)
browser-automation tools inside **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)**.

`opencode-browser` ships as an **OpenCode** plugin, so Claude Code can't load it
directly. This repo is a tiny, zero-dependency **MCP (Model Context Protocol)
bridge** that exposes all of its `browser_*` tools to Claude Code, plus a skill
that teaches Claude the best-practice workflow.

It drives your **real Chromium browser** (Chrome / Brave / Arc / Edge) using your
existing profile — logins, cookies, and sessions all work.

```
Claude Code  ──MCP/stdio──►  bin/server.mjs  ──imports──►  opencode-browser plugin bundle
                                                           │
                                          unix socket ─────┤
                                                           ▼
                                            broker ─► native host ─► browser extension ─► your browser
```

The broker, native messaging host, and browser extension all come from the
upstream package and are **shared, untouched**, with any OpenCode sessions.

---

## Prerequisites

1. A Chromium browser: **Chrome, Brave, Arc, or Edge**.
2. **Node.js** (v18+) and the **Claude Code CLI** (`claude`).
3. The upstream runtime, installed **once**:

   ```bash
   bunx @different-ai/opencode-browser@latest install
   ```

   This installs the broker + native messaging host. (You do **not** need to
   use OpenCode itself — only this one-time setup.) You do not need its
   extension: this repo ships a patched build, installed in the next step.

## Install

```bash
git clone https://github.com/cultlead3r/opencode-browser-claude.git
cd opencode-browser-claude
./install.sh
```

That will:

- Verify it can find the `opencode-browser` plugin bundle (`bin/server.mjs --check`)
- Register the MCP server with Claude Code at **user scope** (all projects)
- Install the `browser-automation` skill to `~/.claude/skills/`
- Install the patched extension to `~/.opencode-browser/extension-claude` and
  print instructions for loading it

Restart Claude Code (or start a new session) and the tools appear as
`mcp__opencode-browser__browser_*`.

### Install options

```bash
./install.sh --allow                      # auto-approve the tools (no per-call prompts)
./install.sh --disable-claude-in-chrome   # block Claude-for-Chrome in favor of these tools
./install.sh --link-skill                 # symlink the skill (stays in sync with the repo)
./install.sh --name my-browser            # register under a different MCP server name
./install.sh --scope project              # write a committable .mcp.json in the cwd instead
```

## Verify

```bash
node bin/server.mjs --check     # prints the resolved plugin path + the 24 tools
claude mcp get opencode-browser # should say: ✔ Connected
```

## Usage

Just ask Claude Code to do something in the browser, e.g.
*"open example.com and read the page"*. Under the hood it calls tools like:

| Tool | Purpose |
|------|---------|
| `browser_open_tab` / `browser_close_tab` | Open / close a tab (each session owns its own tabs) |
| `browser_navigate` | Go to a URL |
| `browser_query` | Read the page (`mode`: `text`, `value`, `list`, `exists`, `page_text`) |
| `browser_click` / `browser_type` / `browser_select` | Interact with elements |
| `browser_scroll` / `browser_wait` | Scroll / wait |
| `browser_screenshot` / `browser_snapshot` | Screenshot / accessibility tree |
| `browser_console` / `browser_errors` | Read page console logs / JS errors |
| `browser_highlight` | Visually highlight an element |
| `browser_download` / `browser_list_downloads` | Downloads |
| `browser_set_file_input` | Upload a local file |
| `browser_get_tabs` / `browser_status` / `browser_*_claim*` | Tabs & broker/ownership state |

Selector helpers (usable in `selector`): `text:Submit`, `label:Email`,
`placeholder:Search`, `name:email`, `role:button`, `aria:...`, or `css:...`.

## Disabling Claude-for-Chrome

If you prefer these tools over Claude Code's built-in `claude-in-chrome`
integration, run `./install.sh --disable-claude-in-chrome`. This adds a `deny`
rule for `mcp__claude-in-chrome` in `~/.claude/settings.json` (a `deny` rule
always wins, so Claude can't call it) and sets `claudeInChromeDefaultEnabled`
to `false`. Undo it with `./uninstall.sh --reenable-claude-in-chrome`.

## Configuration (environment variables)

| Variable | Effect |
|----------|--------|
| `OPENCODE_BROWSER_PLUGIN_PATH` | Force a specific `dist/plugin.js` (skips cache scanning) |
| `OPENCODE_BROWSER_NODE` | Force a specific `node` binary for `run.sh` |
| `OPENCODE_BROWSER_BACKEND=agent` | Use the upstream Playwright/`agent-browser` backend instead of your real browser |

The bridge logs to `~/.opencode-browser/claude-mcp.log`.

## Trusted clicks

The upstream extension clicks by dispatching `mouseover / mousemove /
mousedown / mouseup / click` from a content script. That misses two things:

- **No pointer events.** Component libraries built on Primer, Radix and
  Headless UI open menus from `pointerdown`, so a mouse-only sequence does
  nothing at all. GitHub's issue-form dropdowns are one example.
- **`isTrusted === false`.** Anything that checks event trust ignores it.

The extension in `extension/` fixes both. `browser_click` now resolves the
element in the page, hands its viewport coordinates to the service worker, and
dispatches `Input.dispatchMouseEvent` over the **debugger** session — a real
click through the browser's own input pipeline. The synthetic path is kept as a
fallback (now with pointer events included) for when the debugger can't attach,
e.g. because DevTools already owns the tab. Results say which path ran:

```
Clicked button (trusted)
Clicked button (synthetic -- trusted click unavailable: <reason>)
```

One behavioural difference to know about: a trusted click lands at the
element's centre *coordinates*, so it hits whatever is topmost there. If
something overlays the target, the click goes to the overlay — same as it would
for a human, and unlike the old synthetic path, which dispatched straight at
the element regardless of what was covering it.

This needs no new permissions — `"debugger"` is already in the upstream
manifest, and the console/errors tools already attach a session. A session
opened for a click is detached immediately afterwards, so the "is debugging
this browser" banner doesn't stay up; a session already open for log capture is
left alone.

Because `manifest.json` pins the extension ID with a `key`, the patched build
keeps ID `ncfalpcdanbcccbaakenefpokeioldgd` and the native messaging host's
`allowed_origins` still matches, wherever the directory lives. The flip side:
it and the upstream extension **cannot both be loaded** — same ID.

### Why not upstream's CDP rewrite?

Upstream replaced this whole architecture with direct CDP in May 2026 (v5.0.0,
republished as `opencode-chrome-devtools`). It was never released under the old
name — npm `@different-ai/opencode-browser` is still 4.6.1. That rewrite drops
the extension, native host and broker, which buys trusted input and
`browser_eval`, but costs two things this repo cares about:

- **Your real profile.** Since Chrome 136, `--remote-debugging-port` is ignored
  unless paired with a non-default `--user-data-dir`, so CDP can't attach to
  your everyday browser and its logins.
- **17 of 24 tools.** The CDP package ships 7.

`chrome.debugger` is an extension API and isn't subject to that restriction, so
the patch above takes the good part of the rewrite without either cost.

## How it works

`bin/server.mjs` imports the upstream `dist/plugin.js` and calls its exported
`plugin({})` factory to get the tool map — exactly the contract the upstream
`tool-test.ts` and CLI use. It generates JSON Schemas for each tool from the
plugin's Zod arg definitions (so new upstream tools are picked up
automatically) and serves everything over a minimal MCP stdio (JSON-RPC 2.0)
loop. It writes **nothing** to stdout except protocol messages.

It locates the plugin bundle by checking, in order:

1. `OPENCODE_BROWSER_PLUGIN_PATH`
2. The newest copy in the OpenCode / npx / bun caches
3. A vendored `bin/vendor/plugin.js` (not shipped by default)

`bin/run.sh` is a launcher that resolves `node` robustly, since Claude Code may
spawn MCP servers with a minimal `PATH`.

## Troubleshooting

- **`claude mcp get opencode-browser` not connected** → run `node bin/server.mjs --check`.
  If it can't find the plugin, run the upstream installer (see Prerequisites).
- **"Chrome extension is not connected"** → the browser extension isn't loaded/enabled.
  Re-run `bunx @different-ai/opencode-browser@latest install` and pin the extension.
- **Tools don't show up in Claude Code** → restart Claude Code; confirm with `claude mcp list`.
- **Windows** → `run.sh` is POSIX-only; register the server directly instead:
  `claude mcp add opencode-browser -s user -- node C:\path\to\bin\server.mjs`

## Updating

```bash
git pull
./install.sh        # re-registers; picks up any changes
```

To update the underlying broker/native host: `bunx @different-ai/opencode-browser@latest update`.
That rewrites `~/.opencode-browser/extension`, which you are no longer loading —
re-run `./install.sh` to refresh `extension-claude` and reload it in the browser.

Note that upstream's npm package has been frozen at 4.6.1 since Feb 2026; see
"Why not upstream's CDP rewrite?" above.

## Uninstall

```bash
./uninstall.sh                              # remove MCP server + skill
./uninstall.sh --reenable-claude-in-chrome  # also undo the Claude-for-Chrome block
```

## Credits

- Browser automation engine: **[@different-ai/opencode-browser](https://github.com/different-ai/opencode-browser)**
  by Benjamin Shafii (MIT). This repo only adds the Claude Code / MCP bridge and skill.

## License

[MIT](./LICENSE)

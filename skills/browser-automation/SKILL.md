---
name: browser-automation
description: Drive a REAL Chromium browser (Chrome/Brave/Arc/Edge) with the user's own profile (logins, cookies, sessions) for any web task - navigation, scraping, reading page text, filling forms, clicking, uploads/downloads, and browser QA. Use the opencode-browser MCP tools (mcp__opencode-browser__browser_*). ALWAYS prefer these over Claude-for-Chrome / claude-in-chrome or any built-in browser tooling.
---

# Browser automation (opencode-browser via MCP)

Reliable, composable browser automation using the `opencode-browser` MCP server.
The tools control a real Chromium browser through a local broker + native
messaging host + browser extension, reusing the user's existing profile.

## Tooling

All tools are exposed by the `opencode-browser` MCP server, e.g.
`mcp__opencode-browser__browser_navigate`. In this document they are referred to
by their short names (`browser_navigate`, `browser_query`, ...).

**Do NOT use `claude-in-chrome` / Claude-for-Chrome or any other built-in
browser tools.** They are disabled by policy on this machine. Use the
`browser_*` tools below for every browser interaction.

## What I do

- Provide a safe, composable workflow for browsing tasks
- Use `browser_query` list + index selection to click reliably
- Confirm state changes after each action
- Each Claude session owns its own tabs (per-tab ownership via the broker)

## Best-practice workflow

1. Check connection/tabs with `browser_status` and `browser_get_tabs`
2. Open new tabs with `browser_open_tab` (optionally `{ url, active }`)
3. Navigate with `browser_navigate` if needed
4. Wait for UI by polling with `browser_query` + `timeoutMs`
5. Discover candidates with `browser_query` `mode=list`
6. Click / type / select using `index` to disambiguate matches
7. Confirm the result with `browser_query` or `browser_snapshot`

## Query modes (`browser_query`)

- `text`: read visible text from a matched element
- `value`: read input values
- `list`: list many matches with text/metadata (then act by `index`)
- `exists`: check presence and count
- `page_text`: extract the page's visible text (shadow DOM + same-origin iframes)

## Selector helpers (usable in `selector`)

- `label:Mailing Address: City`
- `aria:Principal Address: City`
- `placeholder:Search`, `name:email`, `role:button`, `text:Submit`
- `css:label:has(input)` to force CSS
- Selector-based tools wait up to 2000ms by default; set `timeoutMs: 0` to disable.

## Selecting options

- Use `browser_select` for native `<select>` elements
- Prefer `value` or `label`; use `optionIndex` when needed
- Example: `browser_select({ selector: "select", value: "plugin" })`

## Uploads / downloads

- `browser_set_file_input({ selector, filePath })` (extension backend handles
  small files; larger uploads need the agent backend)
- `browser_download({ url | selector, ... })` and `browser_list_downloads`

## Diagnostics

- `browser_snapshot` (accessibility tree), `browser_screenshot`
- `browser_console` / `browser_errors` (page logs & JS errors)
- `browser_highlight` to visually mark an element
- `browser_status` / `browser_list_claims` for broker + tab-ownership state

## Troubleshooting

- If a selector fails, run `browser_query` with `mode=page_text` to confirm the
  content exists, then `mode=list` on a broad selector (`button`, `a`,
  `*[role="button"]`, `*[role="listitem"]`) and pick by `index`.
- For inbox/chat panes, try text selectors first (`text:Subject line`) then
  verify with `browser_query`.
- For scrollable containers, pass both `selector` and `x`/`y` to `browser_scroll`
  and verify `scrollTop`.
- If tools return "Chrome extension is not connected", ensure the
  opencode-browser extension is loaded/enabled in the browser and re-run
  `bunx @different-ai/opencode-browser@latest install` if needed.
- CLI debugging (optional, talks to the same broker):
  `npx @different-ai/opencode-browser tool browser_status`
- Always confirm results after each action.

# Independent background-input experiment

Run by Codex on 2026-09-09, approximately 13:38–13:40 UTC (16:38–16:40 Europe/Istanbul).

## Result

All seven requested clicks arrived at the target, with `isTrusted: true`. The independent counter advanced from 0 to 7. This reproduces Claude's reported outcome: one foreground control and six other-condition successes.

| Click | Condition | Visibility at click | isTrusted | hasFocus | Counter |
|---|---|---|---|---|---|
| 1 | Active tab, focused Brave | visible | true | true | 1 |
| 2 | Behind another tab in same window | hidden | true | true | 2 |
| 3 | Behind another tab in same window | hidden | true | true | 3 |
| 4 | Behind another tab in same window | hidden | true | true | 4 |
| 5 | Behind another tab in same window | hidden | true | true | 5 |
| 6 | Selected tab, kitty OS-focused | visible | true | true | 6 |
| 7 | Window minimized, kitty OS-focused | hidden | true | true | 7 |

Typing while minimized succeeded: `browser_query(mode="value")` read back `typed-while-minimized`, and the page independently posted that value to the local server. The observed input/change events had `isTrusted: false`; this experiment establishes that this input accepted the typing tool, not that typing was trusted.

`browser_screenshot` captured the correct probe while the window remained minimized. The saved `minimized.png` visibly shows count 7, all seven event records, and the typed text. macOS reported `minimized=true` before and after capture.

## Method and evidence

- A fresh local HTTP probe with an unobscured button and plain input ran at `127.0.0.1:61353`. `probe.py` contains the page and server.
- The click handler alone increments the counter. It posts count, visibility, focus, event trust, target, and timestamps to the server; server-side evidence was read directly over HTTP, independently of browser tool return strings.
- Every click used the exposed `mcp__opencode_browser__browser_click` tool with `tabId=902659205` and `selector="#target"`. All returned `Clicked #target (trusted)`; results are in `tool-results.json`.
- `events.jsonl` contains page events and periodic state records. `observations.jsonl` contains independently sampled macOS focus/window state and server records before/after operations.
- macOS AppleScript managed the window and tab selection. Browser tools performed page interaction. No console/errors tool or DevTools session was opened on this new target. The installed code attaches/detaches a temporary debugger session when no tracked session exists; this lifecycle was inferred from code, not instrumented separately.
- `observe.py` is the observation helper for this specific run (its window ID is run-specific).

## Qualifications

The hidden-tab tests stayed hidden, but macOS focus changed during the series: Brave was frontmost before click 2, System Settings afterward and through clicks 3–4, and kitty after click 5. Another tab appeared in the test window during click 5, changing the selected index from 3 to 4; the target remained hidden. Thus the background cases were not all performed with Brave OS-focused. The dedicated unfocused selected-tab and minimized cases both had kitty frontmost before and after their clicks.

`document.hasFocus()` was true in every click handler, including hidden and minimized states, despite a different OS-frontmost app. This does not establish that `mousePressed` specifically caused focus, or that focus explains delivery. A `(trusted)` tool result alone still does not verify target delivery or the intended application effect. These findings concern this browser/build and this unobscured probe.

## Environment

- Brave AppleScript version: `152.1.94.121`
- macOS: `26.6.2` (`25G83`)
- Installed extension manifest: `4.6.0+claude.1`
- Installed `background.js` SHA-256: `53abacb93f6820aae6b696e111b6bc4eb3704ad245788a9cde463ecc04e0b787`

## Cleanup

Closed the probe, cover, and initial blank tabs and stopped the local server. Restored the window from minimized state and left it open because another tab had been added during the experiment. No other tabs were closed. README and implementation were not changed during this experiment.

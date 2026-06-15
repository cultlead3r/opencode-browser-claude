#!/bin/sh
# Launcher for the opencode-browser -> Claude Code MCP bridge.
# Claude Code may spawn MCP servers with a minimal PATH, so locate node robustly.
DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER="$DIR/server.mjs"

# 1. Explicit override.
if [ -n "$OPENCODE_BROWSER_NODE" ] && [ -x "$OPENCODE_BROWSER_NODE" ]; then
  exec "$OPENCODE_BROWSER_NODE" "$SERVER" "$@"
fi

# 2. node on PATH (respects the user's current/nvm-selected node).
if command -v node >/dev/null 2>&1; then
  exec node "$SERVER" "$@"
fi

# 3. Common fallback locations (nvm, homebrew, system).
for c in \
  "$HOME/.local/share/nvm/"*/bin/node \
  "$HOME/.nvm/versions/node/"*/bin/node \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  /usr/bin/node ; do
  [ -x "$c" ] && exec "$c" "$SERVER" "$@"
done

echo "opencode-browser MCP bridge: could not find a node executable" >&2
exit 1

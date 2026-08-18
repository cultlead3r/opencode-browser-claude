#!/usr/bin/env bash
#
# opencode-browser-claude installer
# Registers the MCP browser-automation bridge with Claude Code and installs the skill.
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_NAME="opencode-browser"
SCOPE="user"
DISABLE_CIC=0
ALLOW=0
LINK_SKILL=0
LINK_EXTENSION=0

usage() {
  cat <<EOF
opencode-browser-claude installer

Usage: ./install.sh [options]

Options:
  --name <name>                MCP server name (default: opencode-browser)
  --scope <local|user|project> Claude Code config scope (default: user)
  --allow                      Auto-approve the tools (add mcp__<name> to settings allow)
  --disable-claude-in-chrome   Block Claude-for-Chrome (deny mcp__claude-in-chrome)
  --link-skill                 Symlink the skill instead of copying (stays in sync with repo)
  --link-extension             Symlink the patched extension instead of copying
  -h, --help                   Show this help

Prerequisites:
  1. A Chromium browser (Chrome / Brave / Arc / Edge)
  2. Node.js and the Claude Code CLI (\`claude\`)
  3. The upstream runtime installed once:
       bunx @different-ai/opencode-browser@latest install
     (sets up the broker and the native messaging host)

This installer also lays down a patched build of the browser extension that
clicks through the debugger, so clicks are trusted and reach controls that
ignore synthetic events. Load it unpacked from the path printed at the end and
remove the upstream extension: both share one ID and cannot both be loaded.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --name) SERVER_NAME="$2"; shift 2 ;;
    --scope) SCOPE="$2"; shift 2 ;;
    --allow) ALLOW=1; shift ;;
    --disable-claude-in-chrome) DISABLE_CIC=1; shift ;;
    --link-skill) LINK_SKILL=1; shift ;;
    --link-extension) LINK_EXTENSION=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m  ! \033[0m%s\n' "$1"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

# --- 1. Prerequisites -------------------------------------------------
info "Checking prerequisites"
command -v node >/dev/null 2>&1 || die "node not found on PATH. Install Node.js first."
ok "node $(node --version)"
command -v claude >/dev/null 2>&1 || die "Claude Code CLI ('claude') not found. Install Claude Code first."
ok "claude $(claude --version 2>/dev/null | head -1)"

# --- 2. Verify the upstream opencode-browser bundle is reachable ------
info "Locating the opencode-browser plugin bundle"
if node "$REPO_DIR/bin/server.mjs" --check; then
  :
else
  warn "Could not find @different-ai/opencode-browser."
  warn "Install the runtime once, then re-run this script:"
  warn "    bunx @different-ai/opencode-browser@latest install"
  die "Missing prerequisite: @different-ai/opencode-browser"
fi

# --- 3. Make launcher executable -------------------------------------
chmod +x "$REPO_DIR/bin/run.sh" "$REPO_DIR/bin/server.mjs" 2>/dev/null || true

# --- 4. Register the MCP server with Claude Code ---------------------
info "Registering MCP server '$SERVER_NAME' (scope: $SCOPE)"
claude mcp remove "$SERVER_NAME" -s "$SCOPE" >/dev/null 2>&1 || true
claude mcp add "$SERVER_NAME" -s "$SCOPE" -- "$REPO_DIR/bin/run.sh"
ok "registered -> $REPO_DIR/bin/run.sh"

# --- 5. Install the skill --------------------------------------------
SKILL_SRC="$REPO_DIR/skills/browser-automation"
SKILL_DEST="$HOME/.claude/skills/browser-automation"
info "Installing browser-automation skill"
mkdir -p "$HOME/.claude/skills"
rm -rf "$SKILL_DEST"
if [ "$LINK_SKILL" = "1" ]; then
  ln -s "$SKILL_SRC" "$SKILL_DEST"
  ok "symlinked -> $SKILL_DEST"
else
  cp -R "$SKILL_SRC" "$SKILL_DEST"
  ok "copied -> $SKILL_DEST"
fi

# --- 6. Install the patched browser extension ------------------------
EXT_SRC="$REPO_DIR/extension"
EXT_DEST="$HOME/.opencode-browser/extension-claude"
info "Installing patched browser extension"
if [ ! -f "$EXT_SRC/manifest.json" ]; then
  warn "No extension/ directory in the repo - skipping"
else
  mkdir -p "$HOME/.opencode-browser"
  rm -rf "$EXT_DEST"
  if [ "$LINK_EXTENSION" = "1" ]; then
    ln -s "$EXT_SRC" "$EXT_DEST"
    ok "symlinked -> $EXT_DEST"
  else
    cp -R "$EXT_SRC" "$EXT_DEST"
    ok "copied -> $EXT_DEST"
  fi
  EXT_VERSION="$(node -e "process.stdout.write(require('$EXT_DEST/manifest.json').version_name || require('$EXT_DEST/manifest.json').version)" 2>/dev/null || echo "?")"
  ok "extension build $EXT_VERSION"
fi

# --- 7. Optional permission tweaks -----------------------------------
CONFIG_ACTIONS=()
[ "$ALLOW" = "1" ] && CONFIG_ACTIONS+=("--allow")
[ "$DISABLE_CIC" = "1" ] && CONFIG_ACTIONS+=("--disable-claude-in-chrome")
if [ "${#CONFIG_ACTIONS[@]}" -gt 0 ]; then
  info "Applying permission settings"
  node "$REPO_DIR/bin/configure-claude.mjs" --name "$SERVER_NAME" "${CONFIG_ACTIONS[@]}"
fi

# --- 8. Verify -------------------------------------------------------
info "Verifying registration"
claude mcp get "$SERVER_NAME" 2>&1 | sed 's/^/  /' || true

echo
info "Load the patched extension"
echo "    1. Open brave://extensions (or chrome://extensions) and enable Developer mode"
echo "    2. Remove or disable the existing 'OpenCode Browser Automation' entry"
echo "    3. 'Load unpacked' -> $EXT_DEST"
echo "    4. Click the extension's toolbar icon once to connect the native host"
echo "       (it also connects on browser start and on install)"
echo
ok "Done. Restart Claude Code (or start a new session) so the skill and any"
echo "    permission changes take effect. The MCP server is available now."
[ "$ALLOW" = "0" ] && echo "    Tip: pass --allow to auto-approve the tools (no per-call prompts)."
[ "$DISABLE_CIC" = "0" ] && echo "    Tip: pass --disable-claude-in-chrome to block Claude-for-Chrome."

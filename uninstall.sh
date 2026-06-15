#!/usr/bin/env bash
#
# opencode-browser-claude uninstaller
# Removes the MCP server registration and the skill from Claude Code.
# Does NOT touch the upstream @different-ai/opencode-browser runtime/extension.
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_NAME="opencode-browser"
SCOPE="user"
REENABLE_CIC=0

usage() {
  cat <<EOF
opencode-browser-claude uninstaller

Usage: ./uninstall.sh [options]

Options:
  --name <name>                MCP server name (default: opencode-browser)
  --scope <local|user|project> Claude Code config scope (default: user)
  --reenable-claude-in-chrome  Remove the deny rule + re-enable Claude-for-Chrome
  -h, --help                   Show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --name) SERVER_NAME="$2"; shift 2 ;;
    --scope) SCOPE="$2"; shift 2 ;;
    --reenable-claude-in-chrome) REENABLE_CIC=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$1"; }

info "Removing MCP server '$SERVER_NAME' (scope: $SCOPE)"
claude mcp remove "$SERVER_NAME" -s "$SCOPE" >/dev/null 2>&1 || true
ok "unregistered"

SKILL_DEST="$HOME/.claude/skills/browser-automation"
info "Removing skill"
rm -rf "$SKILL_DEST"
ok "removed $SKILL_DEST"

if [ "$REENABLE_CIC" = "1" ]; then
  info "Re-enabling Claude-for-Chrome"
  node "$REPO_DIR/bin/configure-claude.mjs" --name "$SERVER_NAME" --remove-allow --enable-claude-in-chrome
fi

echo
ok "Uninstalled. The opencode-browser browser extension and broker are untouched."
echo "    To remove those too, see: https://github.com/different-ai/opencode-browser"

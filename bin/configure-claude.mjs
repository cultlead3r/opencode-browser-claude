#!/usr/bin/env node
/**
 * configure-claude.mjs
 * --------------------
 * Optional permission tweaks for Claude Code, used by install.sh / uninstall.sh.
 * Edits ~/.claude/settings.json and ~/.claude.json safely (with .bak backups).
 *
 * Usage:
 *   node configure-claude.mjs [--name <mcpName>] [actions...]
 *
 * Actions:
 *   --allow                       Add "mcp__<name>" to permissions.allow (auto-approve the tools)
 *   --remove-allow                Remove "mcp__<name>" from permissions.allow
 *   --disable-claude-in-chrome    Deny mcp__claude-in-chrome + set claudeInChromeDefaultEnabled=false
 *   --enable-claude-in-chrome     Undo the above (remove deny + set flag true)
 *
 * Nothing is done unless at least one action is given.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
const SETTINGS_PATH = join(HOME, ".claude", "settings.json");
const STATE_PATH = join(HOME, ".claude.json");
const CIC = "mcp__claude-in-chrome";

function parseArgs(argv) {
  const out = { name: "opencode-browser", actions: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--name") out.name = argv[++i];
    else if (a.startsWith("--")) out.actions.push(a);
  }
  return out;
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`Could not parse ${path}: ${e.message}`);
  }
}

function backup(path) {
  if (existsSync(path)) {
    try { copyFileSync(path, path + ".bak"); } catch { /* best effort */ }
  }
}

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  backup(path);
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
}

function uniqPush(arr, value) {
  if (!arr.includes(value)) arr.push(value);
}

function main() {
  const { name, actions } = parseArgs(process.argv.slice(2));
  if (!actions.length) {
    console.log("configure-claude: no actions requested, nothing to do.");
    return;
  }
  const rule = `mcp__${name}`;

  const wantAllow = actions.includes("--allow");
  const wantRemoveAllow = actions.includes("--remove-allow");
  const wantDisableCic = actions.includes("--disable-claude-in-chrome");
  const wantEnableCic = actions.includes("--enable-claude-in-chrome");

  // ---- settings.json (permissions) ----
  if (wantAllow || wantRemoveAllow || wantDisableCic || wantEnableCic) {
    const settings = readJson(SETTINGS_PATH, {});
    settings.permissions = settings.permissions || {};
    const p = settings.permissions;
    p.allow = Array.isArray(p.allow) ? p.allow : [];
    p.deny = Array.isArray(p.deny) ? p.deny : [];

    if (wantAllow) uniqPush(p.allow, rule);
    if (wantRemoveAllow) p.allow = p.allow.filter((x) => x !== rule);

    if (wantDisableCic) {
      uniqPush(p.deny, CIC);
      p.allow = p.allow.filter((x) => x !== CIC);
    }
    if (wantEnableCic) {
      p.deny = p.deny.filter((x) => x !== CIC);
    }

    if (!p.deny.length) delete p.deny;
    writeJson(SETTINGS_PATH, settings);
    console.log(`updated ${SETTINGS_PATH}`);
    console.log(`  allow: ${JSON.stringify(p.allow)}`);
    console.log(`  deny:  ${JSON.stringify(p.deny || [])}`);
  }

  // ---- .claude.json (claude-in-chrome flag) ----
  if (wantDisableCic || wantEnableCic) {
    if (existsSync(STATE_PATH)) {
      const state = readJson(STATE_PATH, {});
      state.claudeInChromeDefaultEnabled = wantEnableCic ? true : false;
      writeJson(STATE_PATH, state);
      console.log(
        `updated ${STATE_PATH} (claudeInChromeDefaultEnabled=${state.claudeInChromeDefaultEnabled})`,
      );
    }
  }
}

main();

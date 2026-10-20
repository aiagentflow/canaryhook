import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SETTINGS_PATH = join(".claude", "settings.json");
export const HOOK_COMMAND = "canaryhook hook";

interface HookHandler {
  type?: string;
  command?: string;
  [key: string]: unknown;
}

interface MatcherGroup {
  matcher?: string;
  hooks?: HookHandler[];
  [key: string]: unknown;
}

interface Settings {
  hooks?: Record<string, MatcherGroup[]>;
  [key: string]: unknown;
}

/** Raised instead of silently replacing settings canaryhook cannot parse. */
export class SettingsError extends Error {}

function load(root: string): Settings {
  const path = join(root, SETTINGS_PATH);
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    parsed = undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SettingsError(
      `${SETTINGS_PATH} is not a JSON object. canaryhook will not overwrite it: ` +
        `fix or move the file, then run again.`,
    );
  }
  return parsed as Settings;
}

function save(root: string, settings: Settings): void {
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, SETTINGS_PATH), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export function isRegistered(root: string): boolean {
  const groups = load(root).hooks?.PreToolUse ?? [];
  return groups.some((group) =>
    (group.hooks ?? []).some((handler) => handler.command === HOOK_COMMAND),
  );
}

/** Adds the PreToolUse hook without disturbing hooks that are already there. */
export function register(root: string): boolean {
  if (isRegistered(root)) return false;
  const settings = load(root);
  settings.hooks ??= {};
  settings.hooks.PreToolUse ??= [];
  settings.hooks.PreToolUse.push({
    matcher: "*",
    hooks: [{ type: "command", command: HOOK_COMMAND }],
  });
  save(root, settings);
  return true;
}

export function unregister(root: string): boolean {
  const settings = load(root);
  const groups = settings.hooks?.PreToolUse;
  if (!groups) return false;

  let removed = false;
  const kept = groups
    .map((group) => {
      const handlers = (group.hooks ?? []).filter((handler) => {
        const match = handler.command === HOOK_COMMAND;
        if (match) removed = true;
        return !match;
      });
      return { ...group, hooks: handlers };
    })
    .filter((group) => (group.hooks ?? []).length > 0);

  if (!removed) return false;
  if (kept.length > 0) {
    settings.hooks!.PreToolUse = kept;
  } else {
    delete settings.hooks!.PreToolUse;
    if (Object.keys(settings.hooks!).length === 0) delete settings.hooks;
  }
  save(root, settings);
  return true;
}

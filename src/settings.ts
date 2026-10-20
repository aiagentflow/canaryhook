import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SETTINGS_PATH = join(".claude", "settings.json");
export const HOOK_COMMAND = "canaryhook hook";
export const SESSION_COMMAND = "canaryhook session-start";

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

interface HookSpec {
  event: string;
  matcher?: string;
  command: string;
}

/** Every hook canaryhook installs: one to catch a trip, one to report it. */
const SPECS: HookSpec[] = [
  { event: "PreToolUse", matcher: "*", command: HOOK_COMMAND },
  { event: "SessionStart", command: SESSION_COMMAND },
];

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

function has(settings: Settings, spec: HookSpec): boolean {
  return (settings.hooks?.[spec.event] ?? []).some((group) =>
    (group.hooks ?? []).some((handler) => handler.command === spec.command),
  );
}

/** Whether the PreToolUse hook, the one that catches a trip, is in place. */
export function isRegistered(root: string): boolean {
  return has(load(root), SPECS[0]);
}

/** Whether the SessionStart hook, the one that reports past trips, is in place. */
export function isSessionRegistered(root: string): boolean {
  return has(load(root), SPECS[1]);
}

/** Adds the hooks that are missing without disturbing hooks already there. */
export function register(root: string): boolean {
  const settings = load(root);
  let added = false;
  for (const spec of SPECS) {
    if (has(settings, spec)) continue;
    settings.hooks ??= {};
    settings.hooks[spec.event] ??= [];
    const group: MatcherGroup = { hooks: [{ type: "command", command: spec.command }] };
    if (spec.matcher !== undefined) group.matcher = spec.matcher;
    settings.hooks[spec.event].push(group);
    added = true;
  }
  if (added) save(root, settings);
  return added;
}

export function unregister(root: string): boolean {
  const settings = load(root);
  const ours = new Set(SPECS.map((spec) => spec.command));
  let removed = false;

  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const kept = groups
      .map((group) => {
        const handlers = (group.hooks ?? []).filter((handler) => {
          const match = handler.command !== undefined && ours.has(handler.command);
          if (match) removed = true;
          return !match;
        });
        return { ...group, hooks: handlers };
      })
      .filter((group) => (group.hooks ?? []).length > 0);
    if (kept.length > 0) settings.hooks![event] = kept;
    else delete settings.hooks![event];
  }

  if (!removed) return false;
  if (Object.keys(settings.hooks ?? {}).length === 0) delete settings.hooks;
  save(root, settings);
  return true;
}

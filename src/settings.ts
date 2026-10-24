import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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

export interface HookSpec {
  event: string;
  matcher?: string;
  command: string;
}

/**
 * Every hook canaryhook installs: one to catch a trip before a call runs, one
 * to catch a decoy read through a call's output, and one to report trips.
 */
export const SPECS: HookSpec[] = [
  { event: "PreToolUse", matcher: "*", command: HOOK_COMMAND },
  { event: "SessionStart", command: SESSION_COMMAND },
  { event: "PostToolUse", matcher: "*", command: HOOK_COMMAND },
];

/** Raised instead of silently replacing settings canaryhook cannot parse. */
export class SettingsError extends Error {}

function load(root: string, file: string): Settings {
  const path = join(root, file);
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    parsed = undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SettingsError(
      `${file} is not a JSON object. canaryhook will not overwrite it: ` +
        `fix or move the file, then run again.`,
    );
  }
  return parsed as Settings;
}

function save(root: string, file: string, settings: Settings): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function has(settings: Settings, spec: HookSpec): boolean {
  return (settings.hooks?.[spec.event] ?? []).some((group) =>
    (group.hooks ?? []).some((handler) => handler.command === spec.command),
  );
}

/**
 * Which of `specs` are in place in a settings file shaped like Claude Code's:
 * `hooks` keyed by event, each a list of matcher groups holding commands.
 * Codex and Gemini CLI use the same shape under their own file and event names.
 */
export function registeredSpecs(root: string, file: string, specs: HookSpec[]): boolean[] {
  const settings = load(root, file);
  return specs.map((spec) => has(settings, spec));
}

/** Whether the PreToolUse hook, the one that catches a trip, is in place. */
export function isRegistered(root: string): boolean {
  return registeredSpecs(root, SETTINGS_PATH, SPECS)[0];
}

/** Whether the SessionStart hook, the one that reports past trips, is in place. */
export function isSessionRegistered(root: string): boolean {
  return registeredSpecs(root, SETTINGS_PATH, SPECS)[1];
}

/** Whether the PostToolUse hook, the one that checks tool output, is in place. */
export function isOutputRegistered(root: string): boolean {
  return registeredSpecs(root, SETTINGS_PATH, SPECS)[2];
}

/** Adds the hooks that are missing without disturbing hooks already there. */
export function register(root: string): boolean {
  return registerSpecs(root, SETTINGS_PATH, SPECS);
}

export function unregister(root: string): boolean {
  return unregisterSpecs(root, SETTINGS_PATH, SPECS);
}

export function registerSpecs(root: string, file: string, specs: HookSpec[]): boolean {
  const settings = load(root, file);
  let added = false;
  for (const spec of specs) {
    if (has(settings, spec)) continue;
    settings.hooks ??= {};
    settings.hooks[spec.event] ??= [];
    const group: MatcherGroup = { hooks: [{ type: "command", command: spec.command }] };
    if (spec.matcher !== undefined) group.matcher = spec.matcher;
    settings.hooks[spec.event].push(group);
    added = true;
  }
  if (added) save(root, file, settings);
  return added;
}

export function unregisterSpecs(root: string, file: string, specs: HookSpec[]): boolean {
  const settings = load(root, file);
  const ours = new Set(specs.map((spec) => spec.command));
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
  save(root, file, settings);
  return true;
}

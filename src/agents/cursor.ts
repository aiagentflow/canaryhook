import { existsSync } from "node:fs";
import { join } from "node:path";
import { load, save } from "../settings.js";
import type { Agent, ToolCall } from "./types.js";

const CONFIG = ".cursor/hooks.json";
const HOOK = "canaryhook hook --agent cursor";
const SESSION = "canaryhook session-start --agent cursor";

/** Cursor's hooks.json: a flat list of commands per event, no matcher groups. */
const EVENTS: [string, string][] = [
  ["preToolUse", HOOK],
  ["postToolUse", HOOK],
  ["sessionStart", SESSION],
];

interface Handler {
  command?: string;
  [key: string]: unknown;
}

interface CursorInput {
  conversation_id?: string;
  hook_event_name?: string;
  cwd?: string;
  workspace_roots?: string[];
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
}

function handlers(root: string): Record<string, Handler[]> {
  const config = load(root, CONFIG);
  const hooks = config.hooks;
  return hooks && typeof hooks === "object" ? (hooks as Record<string, Handler[]>) : {};
}

export const cursor: Agent = {
  name: "cursor",
  label: "Cursor",
  configPath: CONFIG,
  hookCommand: HOOK,
  sessionCommand: SESSION,
  detect: (root) => existsSync(join(root, ".cursor")),

  wiring(root) {
    const hooks = handlers(root);
    const wired = (event: string, command: string) =>
      Array.isArray(hooks[event]) && hooks[event].some((h) => h.command === command);
    const [pre, post, session] = EVENTS.map(([event, command]) => wired(event, command));
    return { pre, post, session };
  },
  register(root) {
    const config = load(root, CONFIG);
    config.version ??= 1;
    const hooks = (config.hooks && typeof config.hooks === "object" ? config.hooks : {}) as Record<string, Handler[]>;
    let added = false;
    for (const [event, command] of EVENTS) {
      const list = Array.isArray(hooks[event]) ? hooks[event] : [];
      if (list.some((h) => h.command === command)) continue;
      hooks[event] = [...list, { command }];
      added = true;
    }
    config.hooks = hooks;
    if (added) save(root, CONFIG, config);
    return added;
  },
  unregister(root) {
    if (!existsSync(join(root, CONFIG))) return false;
    const config = load(root, CONFIG);
    const hooks = handlers(root);
    const ours = new Set([HOOK, SESSION]);
    let removed = false;
    for (const [event, list] of Object.entries(hooks)) {
      if (!Array.isArray(list)) continue;
      const kept = list.filter((h) => !(h.command !== undefined && ours.has(h.command)));
      if (kept.length !== list.length) removed = true;
      if (kept.length > 0) hooks[event] = kept;
      else delete hooks[event];
    }
    if (!removed) return false;
    config.hooks = hooks;
    save(root, CONFIG, config);
    return true;
  },

  parse(payload) {
    if (!payload || typeof payload !== "object") return null;
    const input = payload as CursorInput;
    const call: ToolCall = {
      phase: input.hook_event_name === "postToolUse" ? "post" : "pre",
      dirs: [input.cwd, ...(input.workspace_roots ?? []), process.env.CURSOR_PROJECT_DIR, process.cwd()],
      tool: input.tool_name ?? "unknown",
      input: input.tool_input,
      output: input.tool_output,
      sessionId: input.conversation_id,
    };
    return call;
  },
  // Cursor blocks the call when a permission hook prints nothing or something
  // it cannot parse, so a clean call needs an explicit allow.
  pass: (phase) => (phase === "pre" ? JSON.stringify({ permission: "allow" }) : ""),
  deny: (reason) => JSON.stringify({ permission: "deny", user_message: reason, agent_message: reason }),
  flag: (reason) => JSON.stringify({ additional_context: reason }),
  report: (context) => JSON.stringify({ additional_context: context }),

  probe: (root, path) => ({
    conversation_id: "canaryhook-doctor",
    hook_event_name: "preToolUse",
    cwd: root,
    workspace_roots: [root],
    tool_name: "Read",
    tool_input: { file_path: path },
  }),
  verdict(stdout) {
    try {
      const permission = (JSON.parse(stdout) as { permission?: string }).permission;
      if (permission === "allow") return "pass";
      return permission ?? null;
    } catch {
      return null;
    }
  },
};

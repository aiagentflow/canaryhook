import { existsSync } from "node:fs";
import { join } from "node:path";
import { load, save } from "../settings.js";
import type { Agent, ToolCall } from "./types.js";

const CONFIG = ".agents/hooks.json";
const HOOK = "canaryhook hook --agent antigravity";
const SESSION = "canaryhook session-start --agent antigravity";
/** Antigravity keys hooks.json by hook name; this is canaryhook's entry. */
const KEY = "canaryhook";

const entry = () => ({
  PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: HOOK }] }],
  SessionStart: [{ type: "command", command: SESSION }],
});

interface AntigravityInput {
  conversationId?: string;
  workspacePaths?: string[];
  toolCall?: { name?: string; args?: Record<string, unknown> };
}

/**
 * Antigravity's tool arguments under the names the checks look for: the shell
 * command at `command`, the file at `file_path`, written text at `content`.
 */
function normalize(args: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  if (typeof args.CommandLine === "string") out.command = args.CommandLine;
  const path = args.AbsolutePath ?? args.TargetFile;
  if (typeof path === "string") out.file_path = path;
  if (typeof args.CodeContent === "string") out.content = args.CodeContent;
  return out;
}

const mentions = (value: unknown, command: string) => JSON.stringify(value ?? null).includes(JSON.stringify(command));

export const antigravity: Agent = {
  name: "antigravity",
  label: "Antigravity CLI",
  configPath: CONFIG,
  disables: /["']?enabled["']?\s*:\s*false/,
  hookCommand: HOOK,
  sessionCommand: SESSION,
  detect: (root) => ["hooks.json", "rules", "workflows"].some((name) => existsSync(join(root, ".agents", name))),

  wiring(root) {
    const ours = load(root, CONFIG)[KEY] as Record<string, unknown> | undefined;
    const on = !!ours && ours.enabled !== false;
    // PostToolUse payloads carry no tool output, so there is nothing to check after a call.
    return { pre: on && mentions(ours.PreToolUse, HOOK), post: null, session: on && mentions(ours.SessionStart, SESSION) };
  },
  register(root) {
    const config = load(root, CONFIG);
    if (JSON.stringify(config[KEY]) === JSON.stringify(entry())) return false;
    config[KEY] = entry();
    save(root, CONFIG, config);
    return true;
  },
  unregister(root) {
    if (!existsSync(join(root, CONFIG))) return false;
    const config = load(root, CONFIG);
    if (!(KEY in config)) return false;
    delete config[KEY];
    save(root, CONFIG, config);
    return true;
  },

  parse(payload) {
    if (!payload || typeof payload !== "object") return null;
    const input = payload as AntigravityInput;
    if (!input.toolCall) return null;
    const args = normalize(input.toolCall.args);
    const call: ToolCall = {
      phase: "pre",
      dirs: [...(input.workspacePaths ?? []), typeof args.Cwd === "string" ? args.Cwd : undefined, process.cwd()],
      tool: input.toolCall.name ?? "unknown",
      input: args,
      output: undefined,
      sessionId: input.conversationId,
    };
    return call;
  },
  // `decision` is required on every PreToolUse answer; allow hands the call on
  // to the user's own permission rules rather than approving it.
  pass: (phase) => (phase === "pre" ? JSON.stringify({ decision: "allow" }) : ""),
  deny: (reason) => JSON.stringify({ decision: "deny", reason }),
  flag: () => "",
  report: (context) => JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: context } }] }),

  probe: (root, path) => ({
    conversationId: "canaryhook-doctor",
    workspacePaths: [root],
    toolCall: { name: "view_file", args: { AbsolutePath: join(root, path) } },
  }),
  verdict(stdout) {
    try {
      const decision = (JSON.parse(stdout) as { decision?: string }).decision;
      if (decision === "allow") return "pass";
      return decision ?? null;
    } catch {
      return null;
    }
  },
};

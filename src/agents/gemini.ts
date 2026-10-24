import { existsSync } from "node:fs";
import { join } from "node:path";
import { registeredSpecs, registerSpecs, unregisterSpecs, type HookSpec } from "../settings.js";
import type { Agent, ToolCall } from "./types.js";

const CONFIG = ".gemini/settings.json";
const HOOK = "canaryhook hook --agent gemini";
const SESSION = "canaryhook session-start --agent gemini";

/** Tool matchers are regexes; SessionStart matches on its source, so it has none to cover every one. */
const SPECS: HookSpec[] = [
  { event: "BeforeTool", matcher: ".*", command: HOOK },
  { event: "AfterTool", matcher: ".*", command: HOOK },
  { event: "SessionStart", command: SESSION },
];

interface GeminiInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
}

/** Older Gemini CLI releases name the read_file argument `absolute_path`. */
function normalize(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const args = input as Record<string, unknown>;
  return typeof args.absolute_path === "string" && args.file_path === undefined
    ? { ...args, file_path: args.absolute_path }
    : input;
}

export const gemini: Agent = {
  name: "gemini",
  label: "Gemini CLI",
  configPath: CONFIG,
  hookCommand: HOOK,
  sessionCommand: SESSION,
  detect: (root) => existsSync(join(root, ".gemini")),

  wiring(root) {
    const [pre, post, session] = registeredSpecs(root, CONFIG, SPECS);
    return { pre, post, session };
  },
  register: (root) => registerSpecs(root, CONFIG, SPECS),
  unregister: (root) => (existsSync(join(root, CONFIG)) ? unregisterSpecs(root, CONFIG, SPECS) : false),

  parse(payload) {
    if (!payload || typeof payload !== "object") return null;
    const input = payload as GeminiInput;
    const call: ToolCall = {
      phase: input.hook_event_name === "AfterTool" ? "post" : "pre",
      dirs: [input.cwd, process.env.GEMINI_PROJECT_DIR, process.cwd()],
      tool: input.tool_name ?? "unknown",
      input: normalize(input.tool_input),
      output: input.tool_response,
      sessionId: input.session_id,
    };
    return call;
  },
  // Stdout is always parsed as JSON; {} has nothing to say and leaves the
  // user's own confirmation rules in charge.
  pass: () => "{}",
  deny: (reason) => JSON.stringify({ decision: "deny", reason }),
  // On AfterTool, deny hides the real result from the model and sends the
  // reason in its place, so the canary never reaches the agent's context.
  flag: (reason) => JSON.stringify({ decision: "deny", reason }),
  report: (context) =>
    JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }),

  probe: (root, path) => ({
    session_id: "canaryhook-doctor",
    hook_event_name: "BeforeTool",
    cwd: root,
    tool_name: "read_file",
    tool_input: { file_path: path },
  }),
  verdict(stdout) {
    try {
      const decision = (JSON.parse(stdout) as { decision?: string }).decision;
      if (decision === undefined || decision === "allow") return "pass";
      return decision === "block" ? "deny" : decision;
    } catch {
      return null;
    }
  },
};

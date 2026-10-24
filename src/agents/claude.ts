import { HOOK_COMMAND, registeredSpecs, registerSpecs, SESSION_COMMAND, SETTINGS_PATH, SPECS, unregisterSpecs } from "../settings.js";
import type { Agent, ToolCall } from "./types.js";

interface ClaudeInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
}

export const claude: Agent = {
  name: "claude",
  label: "Claude Code",
  configPath: SETTINGS_PATH,
  alsoProtect: [".claude/settings.local.json"],
  disables: /disableAllHooks[\\"']*\s*:\s*true/,
  hookCommand: HOOK_COMMAND,
  sessionCommand: SESSION_COMMAND,
  // Claude Code is always wired by default, whether or not .claude/ exists yet.
  detect: () => true,

  wiring(root) {
    const [pre, session, post] = registeredSpecs(root, SETTINGS_PATH, SPECS);
    return { pre, post, session };
  },
  register: (root) => registerSpecs(root, SETTINGS_PATH, SPECS),
  unregister: (root) => unregisterSpecs(root, SETTINGS_PATH, SPECS),

  parse(payload) {
    if (!payload || typeof payload !== "object") return null;
    const input = payload as ClaudeInput;
    const call: ToolCall = {
      phase: input.hook_event_name === "PostToolUse" ? "post" : "pre",
      // The agent's cwd may be a subdirectory of the project; fall back to the
      // directory Claude Code was started in.
      dirs: [input.cwd, process.env.CLAUDE_PROJECT_DIR, process.cwd()],
      tool: input.tool_name ?? "unknown",
      input: input.tool_input,
      output: input.tool_response,
      sessionId: input.session_id,
    };
    return call;
  },
  pass: () => "",
  deny: (reason) =>
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    }),
  flag: (reason) => JSON.stringify({ decision: "block", reason }),
  report: (context) =>
    JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }),

  probe: (root, path) => ({
    session_id: "canaryhook-doctor",
    cwd: root,
    tool_name: "Read",
    tool_input: { file_path: path },
  }),
  verdict(stdout) {
    if (stdout.trim() === "") return "pass";
    try {
      const parsed = JSON.parse(stdout) as { hookSpecificOutput?: { permissionDecision?: string } };
      return parsed.hookSpecificOutput?.permissionDecision ?? "pass";
    } catch {
      return null;
    }
  },
};

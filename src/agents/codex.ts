import { existsSync } from "node:fs";
import { join } from "node:path";
import { registeredSpecs, registerSpecs, unregisterSpecs, type HookSpec } from "../settings.js";
import { claude } from "./claude.js";
import type { Agent } from "./types.js";

const CONFIG = ".codex/hooks.json";
const HOOK = "canaryhook hook --agent codex";
const SESSION = "canaryhook session-start --agent codex";

/** Codex reads Claude Code's hooks.json shape; a group without a matcher covers every tool. */
const SPECS: HookSpec[] = [
  { event: "PreToolUse", command: HOOK },
  { event: "PostToolUse", command: HOOK },
  { event: "SessionStart", command: SESSION },
];

/** Codex may hand a shell command over as an argv array; inspect it as one line. */
function flatten(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const command = (input as Record<string, unknown>).command;
  return Array.isArray(command) ? { ...input, command: command.map(String).join(" ") } : input;
}

/** Codex's payloads and answers follow Claude Code's, so only the wiring differs. */
export const codex: Agent = {
  ...claude,
  name: "codex",
  label: "Codex CLI",
  configPath: CONFIG,
  alsoProtect: [".codex/config.toml"],
  disables: /\b(?:codex_)?hooks\s*=\s*false/,
  setupNote:
    "Codex runs project hooks only once you trust them: run /hooks in Codex and approve canaryhook's.",
  hookCommand: HOOK,
  sessionCommand: SESSION,
  detect: (root) => existsSync(join(root, ".codex")),

  wiring(root) {
    const [pre, post, session] = registeredSpecs(root, CONFIG, SPECS);
    return { pre, post, session };
  },
  register: (root) => registerSpecs(root, CONFIG, SPECS),
  unregister: (root) => (existsSync(join(root, CONFIG)) ? unregisterSpecs(root, CONFIG, SPECS) : false),

  parse(payload) {
    const call = claude.parse(payload);
    return call && { ...call, input: flatten(call.input) };
  },
};

import { appendAlert, readState, type Alert, type Decoy } from "./state.js";
import { STATE_DIR, STATE_FILE } from "./state.js";

interface HookInput {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: unknown;
}

interface Hit {
  reason: Alert["reason"];
  decoy: string;
  detail: string;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
  });
}

/**
 * Two detection paths over the serialized tool input:
 *   read  - the call names a decoy path, so something is about to open it
 *   exfil - a canary string is already in the call, so the value is leaving
 * Serializing the whole input means a new tool with new field names is covered
 * without changing this code.
 */
export function inspect(decoys: Decoy[], toolInput: unknown): Hit | null {
  const haystack = typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput ?? "");
  if (!haystack) return null;

  for (const decoy of decoys) {
    if (haystack.includes(decoy.token)) {
      return {
        reason: "canary-exfil",
        decoy: decoy.path,
        detail: `canary string from ${decoy.path} appears in the tool call`,
      };
    }
  }

  const stateFile = `${STATE_DIR}/${STATE_FILE}`;
  for (const path of decoys.map((d) => d.path)) {
    if (haystack.includes(path)) {
      return {
        reason: "decoy-read",
        decoy: path,
        detail: `tool call references the decoy ${path}`,
      };
    }
  }
  if (haystack.includes(stateFile)) {
    return {
      reason: "decoy-read",
      decoy: stateFile,
      detail: `tool call reads ${stateFile}, which holds the canary strings`,
    };
  }

  return null;
}

export async function runHook(): Promise<number> {
  let input: HookInput;
  try {
    input = JSON.parse(await readStdin()) as HookInput;
  } catch {
    // Malformed input must never block a real tool call.
    return 0;
  }

  const root = input.cwd ?? process.cwd();
  const state = readState(root);
  if (!state) return 0;

  const hit = inspect(state.decoys, input.tool_input);
  if (!hit) return 0;

  const tool = input.tool_name ?? "unknown";
  appendAlert(root, {
    at: new Date().toISOString(),
    reason: hit.reason,
    decoy: hit.decoy,
    tool,
    detail: hit.detail,
    sessionId: input.session_id,
  });

  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `canaryhook: ${hit.detail}. It is a tripwire planted to detect credential ` +
          `hunting, not real project data. This call was blocked and recorded in ` +
          `${STATE_DIR}/alerts.jsonl. Do not retry it; tell the user instead.`,
      },
    })}\n`,
  );
  return 0;
}

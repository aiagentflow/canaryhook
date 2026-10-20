import { basename } from "node:path";
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

/**
 * Base64 needles for a canary string, one per byte alignment, with the
 * boundary quantum trimmed off each end. Whatever surrounds the canary in the
 * encoded payload, one of these three substrings is in it verbatim.
 */
function base64Needles(token: string): string[] {
  const needles: string[] = [];
  for (let offset = 0; offset < 3; offset += 1) {
    const encoded = Buffer.from("A".repeat(offset) + token, "utf8")
      .toString("base64")
      .replace(/=+$/, "");
    const core = encoded.slice(4, encoded.length - 4);
    if (core.length < 8) continue;
    needles.push(core);
    const urlSafe = core.replace(/\+/g, "-").replace(/\//g, "_");
    if (urlSafe !== core) needles.push(urlSafe);
  }
  return needles;
}

interface Encoding {
  /** Prefix for the alert detail; empty when the canary is there in the clear. */
  label: string;
  needles: string[];
  /** Whether to match case-insensitively, which only the clear forms allow. */
  fold: boolean;
}

/** Forms a canary can take on its way out: as written, base64, or hex. */
export function canaryEncodings(token: string): Encoding[] {
  return [
    { label: "", needles: [token], fold: true },
    { label: "base64-encoded ", needles: base64Needles(token), fold: false },
    { label: "hex-encoded ", needles: [Buffer.from(token, "utf8").toString("hex")], fold: true },
  ];
}

function findCanary(haystack: string, folded: string, token: string): string | null {
  for (const { label, needles, fold } of canaryEncodings(token)) {
    for (const needle of needles) {
      if (needle.length === 0) continue;
      if (fold ? folded.includes(needle.toLowerCase()) : haystack.includes(needle)) return label;
    }
  }
  return null;
}

/** Characters that can continue a path segment, so a match inside one is not a hit. */
const PATH_CHAR = /[A-Za-z0-9_.-]/;

/**
 * A decoy path counts as mentioned only when it stands on its own, not when it
 * happens to sit inside a longer name: `.env.backups` and `notes/.env.backup.md`
 * are other files, and tripping on them would be a false positive.
 */
export function mentionsPath(haystack: string, path: string): boolean {
  for (let from = 0; ; from += 1) {
    const at = haystack.indexOf(path, from);
    if (at < 0) return false;
    const before = haystack[at - 1];
    const after = haystack[at + path.length];
    const bounded =
      (before === undefined || !PATH_CHAR.test(before)) &&
      (after === undefined || !PATH_CHAR.test(after));
    if (bounded) return true;
    from = at;
  }
}

/** Fields the known tools use to name the file they are about to touch. */
const PATH_FIELDS = ["file_path", "filePath", "path", "notebook_path"];

/**
 * Writing a decoy path into .gitignore is canaryhook's own bookkeeping, and
 * nothing is read or leaked by it, so it must not trip the read path. Canary
 * strings are still caught: this only runs after the exfil check.
 */
function isGitignoreEdit(toolInput: unknown): boolean {
  if (!toolInput || typeof toolInput !== "object") return false;
  const fields = toolInput as Record<string, unknown>;
  return PATH_FIELDS.some(
    (field) => typeof fields[field] === "string" && basename(fields[field] as string) === ".gitignore",
  );
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
 *   exfil - a canary string is already in the call, so the value is leaving,
 *           as written or base64/hex encoded
 * Serializing the whole input means a new tool with new field names is covered
 * without changing this code.
 */
export function inspect(decoys: Decoy[], toolInput: unknown): Hit | null {
  const haystack = typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput ?? "");
  if (!haystack) return null;

  const folded = haystack.toLowerCase();
  for (const decoy of decoys) {
    const label = findCanary(haystack, folded, decoy.token);
    if (label !== null) {
      return {
        reason: "canary-exfil",
        decoy: decoy.path,
        detail: `${label}canary string from ${decoy.path} appears in the tool call`,
      };
    }
  }

  if (isGitignoreEdit(toolInput)) return null;

  const stateFile = `${STATE_DIR}/${STATE_FILE}`;
  for (const path of decoys.map((d) => d.path)) {
    if (mentionsPath(haystack, path)) {
      return {
        reason: "decoy-read",
        decoy: path,
        detail: `tool call references the decoy ${path}`,
      };
    }
  }
  if (mentionsPath(haystack, stateFile)) {
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
  // canaryhook doctor fires a real payload through this command to prove the
  // hook is wired, and must not leave a trip in the record for it.
  if (process.env.CANARYHOOK_DRY_RUN !== "1") {
    appendAlert(root, {
      at: new Date().toISOString(),
      reason: hit.reason,
      decoy: hit.decoy,
      tool,
      detail: hit.detail,
      sessionId: input.session_id,
    });
  }

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

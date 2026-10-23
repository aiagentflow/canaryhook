import { basename } from "node:path";
import { appendAlert, findRoot, readState, type Alert, type Decoy } from "./state.js";
import { HOOK_COMMAND } from "./settings.js";
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

/** Commands that handle file names without reading what is inside the files. */
const NON_READING = new Set([
  "ls", "rm", "mv", "find", "stat", "du", "touch", "mkdir", "echo", "printf", "git", "chmod", "chown",
]);

/** Words that run the next word as the command. */
const PREFIXES = new Set(["sudo", "command", "exec", "time", "nice", "env"]);

/** A shell glob as a regex over one file name, or null for a plain word. */
function globRegex(glob: string): RegExp | null {
  if (!/[*?[{]/.test(glob)) return null;
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "[") {
      const end = glob.indexOf("]", i + 2);
      if (end < 0) out += "\\[";
      else {
        out += `[${glob.slice(i + 1, end).replace(/^!/, "^").replace(/\\/g, "\\\\")}]`;
        i = end;
      }
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end < 0) out += "\\{";
      else {
        out += `(?:${glob.slice(i + 1, end).split(",").map((alt) => alt.replace(/[.+^$()|\\]/g, "\\$&")).join("|")})`;
        i = end;
      }
    } else out += c.replace(/[.+^$()|\\\]}]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/**
 * A glob in a shell command that expands to a decoy, like `cat .env*`: the
 * decoy is read without ever being named. Only globs aimed at the project root
 * count, with at least three literal characters (so `*` alone is not taken as
 * aimed at anything), in a command that reads what it is given.
 */
export function globbedDecoy(command: string, paths: string[]): string | null {
  for (const segment of command.split(/[;&|\n]|\$\(|`/)) {
    const words = segment.trim().split(/\s+/).filter((w) => w.length > 0);
    let at = 0;
    while (at < words.length && (PREFIXES.has(words[at]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[at]))) at += 1;
    if (at >= words.length || NON_READING.has(words[at])) continue;
    for (const word of words.slice(at + 1)) {
      if (/^(['"]).*\1$/.test(word)) continue; // quoted globs do not expand
      const bare = word.replace(/['"]/g, "");
      const slash = bare.lastIndexOf("/");
      const dir = bare.slice(0, slash + 1);
      const name = bare.slice(slash + 1);
      if (dir !== "" && !/^(\.\/|\.\.\/)+$/.test(dir)) continue;
      if (name.replace(/[*?]|\[[^\]]*\]|\{[^}]*\}/g, "").length < 3) continue;
      const re = globRegex(name);
      if (!re) continue;
      for (const path of paths) {
        if (path.startsWith(".") && !name.startsWith(".")) continue; // * skips dotfiles
        if (re.test(path)) return path;
      }
    }
  }
  return null;
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

/** The shell command of a Bash-style call, if it has one. */
function commandOf(toolInput: unknown): string | null {
  if (!toolInput || typeof toolInput !== "object") return null;
  const command = (toolInput as Record<string, unknown>).command;
  return typeof command === "string" ? command : null;
}

/** Commands that change or remove the files they are given. */
const MUTATING = new Set(["rm", "unlink", "shred", "truncate", "mv", "cp", "ln", "tee", "dd", "chmod"]);

/** Commands that only change a file when told to edit it in place. */
const IN_PLACE = new Set(["sed", "perl"]);

/** Settings files Claude Code reads hooks from, where the hook can be switched off. */
const SETTINGS_FILES = [".claude/settings.json", ".claude/settings.local.json"];

/** Fields the editing tools carry the new content in. */
const WRITE_FIELDS = ["content", "new_string", "edits", "new_source"];

const mentionsState = (text: string) => mentionsPath(text, STATE_DIR);
const mentionsSettings = (text: string) => SETTINGS_FILES.some((file) => mentionsPath(text, file));
const disablesHooks = (text: string) => /disableAllHooks[\\"']*\s*:\s*true/.test(text);

/**
 * A call that would blind canaryhook: erase or rewrite its record, unregister
 * its hook, or turn hooks off. Without this an agent that trips a decoy could
 * wipe the evidence and carry on. The user can still do all of it themselves,
 * from a terminal, where no hook runs.
 */
export function tampers(toolInput: unknown): string | null {
  if (!toolInput || typeof toolInput !== "object") return null;
  const fields = toolInput as Record<string, unknown>;

  const command = commandOf(toolInput);
  if (command !== null) return tampersInShell(command);

  const path = PATH_FIELDS.map((field) => fields[field]).find((value) => typeof value === "string") as
    | string
    | undefined;
  if (path === undefined || !WRITE_FIELDS.some((field) => field in fields)) return null;
  const written = JSON.stringify(WRITE_FIELDS.map((field) => fields[field] ?? null));

  if (mentionsState(path)) return `tool call writes to ${STATE_DIR}/, canaryhook's record`;
  if (!mentionsSettings(path)) return null;
  if (disablesHooks(written)) return "tool call turns off all hooks, canaryhook's among them";
  const edits = Array.isArray(fields.edits) ? (fields.edits as Record<string, unknown>[]) : [fields];
  const dropsHook = edits.some(
    (edit) =>
      typeof edit.old_string === "string" &&
      edit.old_string.includes(HOOK_COMMAND) &&
      !String(edit.new_string ?? "").includes(HOOK_COMMAND),
  );
  const rewritesWithout =
    typeof fields.content === "string" && path.endsWith("settings.json") && !fields.content.includes(HOOK_COMMAND);
  if (dropsHook || rewritesWithout) return "tool call removes canaryhook's hook from the settings";
  return null;
}

function tampersInShell(command: string): string | null {
  if (/\bcanaryhook(@\S+)?\s+clean\b/.test(command)) return "tool call runs canaryhook clean";
  if (disablesHooks(command) && mentionsSettings(command)) {
    return "tool call turns off all hooks, canaryhook's among them";
  }
  for (const segment of command.split(/[;&|\n]|\$\(|`/)) {
    const words = segment.trim().split(/\s+/).filter((w) => w.length > 0);
    let at = 0;
    while (at < words.length && (PREFIXES.has(words[at]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[at]))) at += 1;
    const name = words[at] ?? "";
    const mutates =
      MUTATING.has(name) || (IN_PLACE.has(name) && words.some((w) => /^(-i|--in-place)/.test(w)));
    const targets = mutates ? words.slice(at + 1) : [];
    for (const match of segment.matchAll(/(?:^|[^0-9&<>])>>?\s*(\S+)/g)) targets.push(match[1]);

    if (targets.some(mentionsState)) return `tool call changes ${STATE_DIR}/, canaryhook's record`;
    // Rewriting the settings for other reasons is fine; only a removal, or a
    // rewrite that is about hooks, can take the hook out.
    if (targets.some(mentionsSettings)) {
      const destroys = ["rm", "unlink", "shred", "truncate"].includes(name);
      if (destroys || /canaryhook|hooks/i.test(command)) return "tool call rewrites the settings that hold canaryhook's hook";
    }
  }
  return null;
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

  const tamper = tampers(toolInput);
  if (tamper) return { reason: "tamper", decoy: STATE_DIR, detail: tamper };

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
  const command = commandOf(toolInput);
  const globbed = command === null ? null : globbedDecoy(command, decoys.map((d) => d.path));
  if (globbed) {
    return {
      reason: "decoy-read",
      decoy: globbed,
      detail: `tool call reads ${globbed} through a glob`,
    };
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

  // The agent's cwd may be a subdirectory of the project; fall back to the
  // directory Claude Code was started in.
  const root = [input.cwd, process.env.CLAUDE_PROJECT_DIR, process.cwd()]
    .map((dir) => (dir ? findRoot(dir) : null))
    .find((dir) => dir !== null);
  if (!root) return 0;
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
          hit.reason === "tamper"
            ? `canaryhook: ${hit.detail}. Its record and hook are protected from agent ` +
              `changes, so this call was blocked and recorded in ${STATE_DIR}/alerts.jsonl. ` +
              `If the user wants canaryhook changed or removed, they can run it themselves ` +
              `from a terminal. Do not retry it; tell the user instead.`
            : `canaryhook: ${hit.detail}. It is a tripwire planted to detect credential ` +
              `hunting, not real project data. This call was blocked and recorded in ` +
              `${STATE_DIR}/alerts.jsonl. Do not retry it; tell the user instead.`,
      },
    })}\n`,
  );
  return 0;
}

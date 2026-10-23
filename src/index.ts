#!/usr/bin/env node
import { alerts } from "./commands/alerts.js";
import { clean } from "./commands/clean.js";
import { doctor } from "./commands/doctor.js";
import { init } from "./commands/init.js";
import { status } from "./commands/status.js";
import { verify } from "./commands/verify.js";
import { sessionStart } from "./commands/session.js";
import { runHook } from "./hook.js";
import { findRoot } from "./state.js";
import { VERSION } from "./version.js";

const HELP = `canaryhook ${VERSION}: honeyfiles and canary tokens for AI coding agents

Usage
  canaryhook <command> [options]

Commands
  init        Plant decoy credential files and register the tool-call hook
  status      Show whether decoys are planted and the hook is wired
  alerts      List recorded trips
  doctor      Fire a test payload through the hook to prove it is wired
  verify      Exit non-zero if a decoy was read or a canary leaked
  clean       Remove planted decoys and unregister the hook
  hook           Internal: read a tool-call hook payload on stdin and judge it
  session-start  Internal: report outstanding trips at the start of a session

Options
  --json           Machine-readable output
  --commit         init: track the decoys in git instead of ignoring them
  --force          init: replant over an existing setup
  --keep-alerts    clean: keep .canaryhook/alerts.jsonl
  -h, --help       Show this help
  -v, --version    Show version

Docs: https://github.com/aiagentflow/canaryhook
`;

/** Flags each command accepts beyond --json, -h and -v. */
const FLAGS: Record<string, string[]> = {
  init: ["--commit", "--force"],
  clean: ["--keep-alerts"],
  status: [],
  alerts: [],
  doctor: [],
  verify: [],
};

/**
 * A mistyped flag would otherwise be ignored, so `init --froce` reports
 * "already initialized" and `clean --keep-alert` deletes the record it meant
 * to keep. The internal hook commands are left out: a hook must never fail.
 */
function unknownArg(command: string, args: string[]): string | null {
  const allowed = FLAGS[command];
  if (allowed === undefined) return null;
  const known = new Set([...allowed, "--json", "-h", "--help", "-v", "--version"]);
  return args.find((arg) => (arg.startsWith("-") ? !known.has(arg) : arg !== command)) ?? null;
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const has = (flag: string) => args.includes(flag);
  const command = args.find((a) => !a.startsWith("-"));
  // init plants where it is run; every other command works on the nearest
  // initialized project, so running one from a subdirectory sees the real state.
  const root = command === "init" ? process.cwd() : (findRoot(process.cwd()) ?? process.cwd());
  const json = has("--json");

  if (has("-v") || has("--version")) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (!command || has("-h") || has("--help")) {
    process.stdout.write(HELP);
    return 0;
  }

  const unknown = unknownArg(command, args);
  if (unknown !== null) {
    process.stderr.write(`Unknown option for ${command}: ${unknown}\n\n${HELP}`);
    return 1;
  }

  switch (command) {
    case "hook":
      return runHook();
    case "session-start":
      return sessionStart(root);
    case "init":
      return init(root, { json, commit: has("--commit"), force: has("--force") });
    case "status":
      return status(root, { json });
    case "alerts":
      return alerts(root, { json });
    case "doctor":
      return doctor(root, { json });
    case "verify":
      return verify(root, { json });
    case "clean":
      return clean(root, { json, keepAlerts: has("--keep-alerts") });
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
      return 1;
  }
}

process.exitCode = await main(process.argv);

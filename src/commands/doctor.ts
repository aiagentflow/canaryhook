import { spawnSync } from "node:child_process";
import { HOOK_COMMAND, isRegistered, SettingsError, SETTINGS_PATH } from "../settings.js";
import { isDecoyFile, readState, type Decoy } from "../state.js";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Runs the hook command exactly as the agent would, with a payload on stdin,
 * and returns the permission decision it printed. CANARYHOOK_DRY_RUN keeps the
 * probe out of the alert record.
 */
function askHook(root: string, toolInput: unknown): { decision: string | null; error: string | null } {
  const payload = JSON.stringify({
    session_id: "canaryhook-doctor",
    cwd: root,
    tool_name: "Read",
    tool_input: toolInput,
  });
  const run = spawnSync(HOOK_COMMAND, {
    cwd: root,
    input: payload,
    shell: true,
    encoding: "utf8",
    env: { ...process.env, CANARYHOOK_DRY_RUN: "1" },
  });
  if (run.error) return { decision: null, error: run.error.message };
  if (run.status !== 0) {
    return { decision: null, error: `exited ${run.status}: ${(run.stderr ?? "").trim()}` };
  }
  const out = (run.stdout ?? "").trim();
  if (out.length === 0) return { decision: null, error: null };
  try {
    const parsed = JSON.parse(out) as { hookSpecificOutput?: { permissionDecision?: string } };
    return { decision: parsed.hookSpecificOutput?.permissionDecision ?? null, error: null };
  } catch {
    return { decision: null, error: `hook printed something that is not JSON: ${out.slice(0, 120)}` };
  }
}

function decoyChecks(root: string, decoys: Decoy[]): Check {
  const broken = decoys.filter((decoy) => !isDecoyFile(root, decoy));
  return {
    name: "decoys planted",
    ok: broken.length === 0,
    detail:
      broken.length === 0
        ? `${decoys.length} decoys in place, each holding its canary`
        : `missing or no longer holding their canary: ${broken.map((d) => d.path).join(", ")}`,
  };
}

export function doctor(root: string, options: { json: boolean }): number {
  const state = readState(root);
  if (!state) {
    const message = "canaryhook is not initialized here. Run: canaryhook init";
    if (options.json) process.stdout.write(`${JSON.stringify({ ok: false, message })}\n`);
    else process.stderr.write(`${message}\n`);
    return 1;
  }

  const checks: Check[] = [decoyChecks(root, state.decoys)];

  let registered = false;
  try {
    registered = isRegistered(root);
    checks.push({
      name: "hook registered",
      ok: registered,
      detail: registered ? `${HOOK_COMMAND} in ${SETTINGS_PATH}` : `not found in ${SETTINGS_PATH}`,
    });
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    checks.push({ name: "hook registered", ok: false, detail: error.message });
  }

  const trip = askHook(root, { file_path: state.decoys[0]?.path ?? ".env.backup" });
  checks.push({
    name: "hook denies a decoy read",
    ok: trip.decision === "deny",
    detail:
      trip.error !== null
        ? `could not run ${HOOK_COMMAND}: ${trip.error}`
        : trip.decision === "deny"
          ? "a planted read came back denied"
          : "the hook ran but let a decoy read through",
  });

  const quiet = askHook(root, { file_path: "src/index.ts" });
  checks.push({
    name: "hook passes normal calls",
    ok: quiet.error === null && quiet.decision === null,
    detail:
      quiet.error !== null
        ? `could not run ${HOOK_COMMAND}: ${quiet.error}`
        : quiet.decision === null
          ? "an ordinary read was left alone"
          : `an ordinary read came back ${quiet.decision}`,
  });

  const ok = checks.every((check) => check.ok);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok, checks })}\n`);
    return ok ? 0 : 1;
  }

  for (const check of checks) {
    process.stdout.write(`${check.ok ? "ok    " : "FAIL  "} ${check.name}\n        ${check.detail}\n`);
  }
  process.stdout.write(
    ok
      ? "\nThe hook is wired and firing.\n"
      : `\nSomething is wrong. If ${HOOK_COMMAND} cannot run, the hook fails open and\n` +
          "nothing is being watched. Reinstall canaryhook, or run canaryhook init --force.\n",
  );
  return ok ? 0 : 1;
}

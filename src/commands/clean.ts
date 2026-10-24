import { existsSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { AGENTS } from "../agents/index.js";
import { SettingsError } from "../settings.js";
import { isDecoyFile, readState, STATE_DIR } from "../state.js";

export function clean(root: string, options: { json: boolean; keepAlerts: boolean }): number {
  const state = readState(root);
  if (!state) {
    const message = "canaryhook is not initialized here.";
    if (options.json) process.stdout.write(`${JSON.stringify({ ok: false, message })}\n`);
    else process.stderr.write(`${message}\n`);
    return 1;
  }

  const removed: string[] = [];
  const kept: string[] = [];
  for (const decoy of state.decoys) {
    if (isDecoyFile(root, decoy)) {
      unlinkSync(join(root, decoy.path));
      removed.push(decoy.path);
    } else if (existsSync(join(root, decoy.path))) {
      kept.push(decoy.path);
    }
  }
  // Every agent, not only the ones recorded as wired: a hook left pointing at a
  // removed install would fail open without saying so.
  let hookRemoved = false;
  let settingsProblem: string | null = null;
  for (const agent of AGENTS) {
    try {
      if (agent.unregister(root)) hookRemoved = true;
    } catch (error) {
      if (!(error instanceof SettingsError)) throw error;
      settingsProblem ??= error.message;
    }
  }
  if (!options.keepAlerts) rmSync(join(root, STATE_DIR), { recursive: true, force: true });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        removed,
        kept,
        hookRemoved,
        settingsProblem,
        alertsKept: options.keepAlerts,
      })}\n`,
    );
    return 0;
  }
  process.stdout.write(`Removed ${removed.length} decoy(s).\n`);
  if (kept.length > 0) {
    process.stdout.write(
      `Left ${kept.join(", ")} in place: no longer canaryhook decoys.\n`,
    );
  }
  if (settingsProblem) process.stdout.write(`${settingsProblem}\n`);
  else process.stdout.write(hookRemoved ? "Unregistered the hooks.\n" : "No hook to unregister.\n");
  process.stdout.write(
    options.keepAlerts ? `Kept ${STATE_DIR}/alerts.jsonl.\n` : `Removed ${STATE_DIR}/.\n`,
  );
  return 0;
}

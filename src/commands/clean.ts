import { existsSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { unregister } from "../settings.js";
import { readState, STATE_DIR } from "../state.js";

export function clean(root: string, options: { json: boolean; keepAlerts: boolean }): number {
  const state = readState(root);
  if (!state) {
    const message = "canaryhook is not initialized here.";
    if (options.json) process.stdout.write(`${JSON.stringify({ ok: false, message })}\n`);
    else process.stderr.write(`${message}\n`);
    return 1;
  }

  const removed: string[] = [];
  for (const decoy of state.decoys) {
    const path = join(root, decoy.path);
    if (existsSync(path)) {
      unlinkSync(path);
      removed.push(decoy.path);
    }
  }
  const hookRemoved = unregister(root);
  if (!options.keepAlerts) rmSync(join(root, STATE_DIR), { recursive: true, force: true });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, removed, hookRemoved, alertsKept: options.keepAlerts })}\n`,
    );
    return 0;
  }
  process.stdout.write(`Removed ${removed.length} decoy(s).\n`);
  process.stdout.write(hookRemoved ? "Unregistered the PreToolUse hook.\n" : "No hook to unregister.\n");
  process.stdout.write(
    options.keepAlerts ? `Kept ${STATE_DIR}/alerts.jsonl.\n` : `Removed ${STATE_DIR}/.\n`,
  );
  return 0;
}

import { existsSync } from "node:fs";
import { join } from "node:path";
import { claude } from "../agents/index.js";
import { SettingsError } from "../settings.js";
import { readAlerts, readState } from "../state.js";

export function status(root: string, options: { json: boolean }): number {
  const state = readState(root);
  if (!state) {
    const message = "canaryhook is not initialized here. Run: canaryhook init";
    if (options.json) process.stdout.write(`${JSON.stringify({ initialized: false, message })}\n`);
    else process.stderr.write(`${message}\n`);
    return 1;
  }

  const decoys = state.decoys.map((decoy) => ({
    path: decoy.path,
    kind: decoy.kind,
    planted: existsSync(join(root, decoy.path)),
  }));
  let hook = false;
  let sessionHook = false;
  let outputHook = false;
  let settingsProblem: string | null = null;
  try {
    ({ pre: hook, session: sessionHook, post: outputHook } = claude.wiring(root));
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    settingsProblem = error.message;
  }
  const alerts = readAlerts(root);
  const missing = decoys.filter((d) => !d.planted).length;
  const healthy = hook && sessionHook && outputHook && missing === 0;

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({
        initialized: true,
        created: state.created,
        hookRegistered: hook,
        sessionHookRegistered: sessionHook,
        outputHookRegistered: outputHook,
        settings: claude.configPath,
        decoys,
        alerts: alerts.length,
        settingsProblem,
        healthy,
      })}\n`,
    );
    return healthy ? 0 : 1;
  }

  process.stdout.write(`Initialized  ${state.created}\n`);
  process.stdout.write(`Hook         ${hook ? `registered in ${claude.configPath}` : "NOT registered"}\n`);
  process.stdout.write(`Session hook ${sessionHook ? "registered" : "NOT registered"}\n`);
  process.stdout.write(`Output hook  ${outputHook ? "registered" : "NOT registered"}\n`);
  process.stdout.write("Decoys\n");
  for (const decoy of decoys) {
    process.stdout.write(`  ${decoy.planted ? "ok     " : "MISSING"} ${decoy.path}\n`);
  }
  process.stdout.write(`Alerts       ${alerts.length}\n`);
  if (settingsProblem) process.stdout.write(`\n${settingsProblem}\n`);
  else if (!healthy) process.stdout.write("\nRun canaryhook init --force to repair.\n");
  return healthy ? 0 : 1;
}

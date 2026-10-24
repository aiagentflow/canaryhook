import { existsSync } from "node:fs";
import { join } from "node:path";
import { claude, wiredAgents } from "../agents/index.js";
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
  const agents = wiredAgents(state).map((agent) => {
    try {
      return { agent, ...agent.wiring(root), problem: null as string | null };
    } catch (error) {
      if (!(error instanceof SettingsError)) throw error;
      return { agent, pre: false, post: false, session: false, problem: error.message };
    }
  });
  const all = (key: "pre" | "post" | "session") => agents.every((a) => a[key]);
  const settingsProblem = agents.find((a) => a.problem !== null)?.problem ?? null;
  const alerts = readAlerts(root);
  const missing = decoys.filter((d) => !d.planted).length;
  const healthy = all("pre") && all("session") && all("post") && missing === 0;

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({
        initialized: true,
        created: state.created,
        hookRegistered: all("pre"),
        sessionHookRegistered: all("session"),
        outputHookRegistered: all("post"),
        settings: claude.configPath,
        agents: agents.map((a) => ({
          name: a.agent.name,
          config: a.agent.configPath,
          hookRegistered: a.pre,
          sessionHookRegistered: a.session,
          outputHookRegistered: a.post,
          settingsProblem: a.problem,
        })),
        decoys,
        alerts: alerts.length,
        settingsProblem,
        healthy,
      })}\n`,
    );
    return healthy ? 0 : 1;
  }

  const mark = (ok: boolean) => (ok ? "registered" : "NOT registered");
  process.stdout.write(`Initialized  ${state.created}\n`);
  for (const a of agents) {
    process.stdout.write(`${a.agent.label} (${a.agent.configPath})\n`);
    process.stdout.write(`  Hook         ${mark(a.pre)}\n`);
    process.stdout.write(`  Session hook ${mark(a.session)}\n`);
    process.stdout.write(`  Output hook  ${mark(a.post)}\n`);
    if (a.agent.setupNote) process.stdout.write(`  Note         ${a.agent.setupNote}\n`);
  }
  process.stdout.write("Decoys\n");
  for (const decoy of decoys) {
    process.stdout.write(`  ${decoy.planted ? "ok     " : "MISSING"} ${decoy.path}\n`);
  }
  process.stdout.write(`Alerts       ${alerts.length}\n`);
  if (settingsProblem) process.stdout.write(`\n${settingsProblem}\n`);
  else if (!healthy) process.stdout.write("\nRun canaryhook init --force to repair.\n");
  return healthy ? 0 : 1;
}

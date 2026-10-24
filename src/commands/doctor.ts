import { spawnSync } from "node:child_process";
import { claude, type Agent } from "../agents/index.js";
import { SettingsError } from "../settings.js";
import { isDecoyFile, readState, type Decoy } from "../state.js";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Runs the hook command exactly as the agent would, with a payload on stdin,
 * and returns what the agent would make of its answer. CANARYHOOK_DRY_RUN
 * keeps the probe out of the alert record.
 */
function askHook(agent: Agent, root: string, path: string): { decision: string | null; error: string | null } {
  const run = spawnSync(agent.hookCommand, {
    cwd: root,
    input: JSON.stringify(agent.probe(root, path)),
    shell: true,
    encoding: "utf8",
    env: { ...process.env, CANARYHOOK_DRY_RUN: "1" },
  });
  if (run.error) return { decision: null, error: run.error.message };
  if (run.status !== 0) {
    return { decision: null, error: `exited ${run.status}: ${(run.stderr ?? "").trim()}` };
  }
  const out = (run.stdout ?? "").trim();
  const decision = agent.verdict(out);
  if (decision === null) return { decision: null, error: `hook printed something it should not: ${out.slice(0, 120)}` };
  return { decision, error: null };
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

export function doctor(root: string, options: { json: boolean }, agent: Agent = claude): number {
  const state = readState(root);
  if (!state) {
    const message = "canaryhook is not initialized here. Run: canaryhook init";
    if (options.json) process.stdout.write(`${JSON.stringify({ ok: false, message })}\n`);
    else process.stderr.write(`${message}\n`);
    return 1;
  }

  const checks: Check[] = [decoyChecks(root, state.decoys)];

  try {
    const registered = agent.wiring(root).pre;
    checks.push({
      name: "hook registered",
      ok: registered,
      detail: registered ? `${agent.hookCommand} in ${agent.configPath}` : `not found in ${agent.configPath}`,
    });
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    checks.push({ name: "hook registered", ok: false, detail: error.message });
  }

  const trip = askHook(agent, root, state.decoys[0]?.path ?? ".env.backup");
  checks.push({
    name: "hook denies a decoy read",
    ok: trip.decision === "deny",
    detail:
      trip.error !== null
        ? `could not run ${agent.hookCommand}: ${trip.error}`
        : trip.decision === "deny"
          ? "a planted read came back denied"
          : "the hook ran but let a decoy read through",
  });

  const quiet = askHook(agent, root, "src/index.ts");
  checks.push({
    name: "hook passes normal calls",
    ok: quiet.error === null && quiet.decision === "pass",
    detail:
      quiet.error !== null
        ? `could not run ${agent.hookCommand}: ${quiet.error}`
        : quiet.decision === "pass"
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
      : `\nSomething is wrong. If ${agent.hookCommand} cannot run, the hook fails open and\n` +
          "nothing is being watched. Reinstall canaryhook, or run canaryhook init --force.\n",
  );
  return ok ? 0 : 1;
}

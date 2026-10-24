import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDecoys } from "../canaries.js";
import { AGENTS, claude, type Agent } from "../agents/index.js";
import { SettingsError } from "../settings.js";
import { isDecoyFile, readState, writeState, STATE_DIR, type Decoy } from "../state.js";

const IGNORE_MARKER = "# canaryhook decoys";

function updateGitignore(root: string, decoys: Decoy[]): boolean {
  const path = join(root, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (existing.includes(IGNORE_MARKER)) return false;
  const block = [IGNORE_MARKER, `${STATE_DIR}/`, ...decoys.map((d) => d.path), ""].join("\n");
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(path, `${existing}${sep}${existing.length > 0 ? "\n" : ""}${block}`, "utf8");
  return true;
}

function fail(message: string, json: boolean): number {
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, message })}\n`);
  else process.stderr.write(`${message}\n`);
  return 1;
}

export function init(
  root: string,
  options: { json: boolean; commit: boolean; force: boolean; agents?: Agent[] },
): number {
  const existing = readState(root);
  if (existing && !options.force) {
    return fail(`canaryhook is already initialized in ${root}. Use --force to replant.`, options.json);
  }

  // Read the settings before planting anything, so a settings file canaryhook
  // cannot parse stops the run instead of leaving half an install behind.
  // Without --agents, wire Claude Code plus any agent the project already
  // uses, and keep whatever a previous init wired.
  const previous = existing?.agents ?? [];
  const agents =
    options.agents ?? AGENTS.filter((agent) => agent.detect(root) || previous.includes(agent.name));
  try {
    for (const agent of agents) agent.wiring(root);
  } catch (error) {
    if (error instanceof SettingsError) return fail(error.message, options.json);
    throw error;
  }

  if (existing) {
    for (const decoy of existing.decoys) {
      if (isDecoyFile(root, decoy)) unlinkSync(join(root, decoy.path));
    }
  }

  const built = buildDecoys();
  // Anything still sitting at a decoy path is a real file of the user's, since
  // decoys recorded in the previous state were just removed. Never clobber it.
  const collisions = built
    .map((b) => b.decoy.path)
    .filter((path) => existsSync(join(root, path)));
  if (collisions.length > 0) {
    return fail(
      `These files already exist and are not canaryhook decoys: ${collisions.join(", ")}. ` +
        `Move or rename them, then run canaryhook init again.`,
      options.json,
    );
  }

  for (const { decoy, body } of built) {
    writeFileSync(join(root, decoy.path), body, "utf8");
  }

  const decoys = built.map((b) => b.decoy);
  // An agent dropped from the list on a replant is unwired, so it is not left
  // pointing at canaryhook without being reported anywhere.
  for (const agent of AGENTS) {
    if (agents.includes(agent)) continue;
    try {
      agent.unregister(root);
    } catch (error) {
      // A config canaryhook cannot read is not one it wrote to.
      if (!(error instanceof SettingsError)) throw error;
    }
  }
  const added = agents.map((agent) => agent.register(root));
  writeState(root, {
    version: 1,
    created: new Date().toISOString(),
    decoys,
    hookRegistered: true,
    agents: agents.map((agent) => agent.name),
  });

  const ignored = options.commit ? false : updateGitignore(root, decoys);

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        planted: decoys.map((d) => d.path),
        hookRegistered: added.some(Boolean),
        settings: claude.configPath,
        agents: agents.map((agent, i) => ({ name: agent.name, config: agent.configPath, registered: added[i] })),
        gitignoreUpdated: ignored,
      })}\n`,
    );
    return 0;
  }

  process.stdout.write(`Planted ${decoys.length} decoys:\n`);
  for (const decoy of decoys) process.stdout.write(`  ${decoy.path}  (${decoy.kind})\n`);
  process.stdout.write("\n");
  agents.forEach((agent, i) => {
    process.stdout.write(
      added[i]
        ? `Registered the hooks for ${agent.label} in ${agent.configPath}.\n`
        : `The hooks for ${agent.label} were already registered in ${agent.configPath}.\n`,
    );
  });
  if (ignored) process.stdout.write("Added the decoys and .canaryhook/ to .gitignore.\n");
  if (options.commit) process.stdout.write("Left .gitignore alone, as --commit was passed.\n");
  process.stdout.write(
    "\nNothing in your project should ever read these files. If an agent does,\n" +
      "the call is blocked and recorded in .canaryhook/alerts.jsonl.\n",
  );
  return 0;
}

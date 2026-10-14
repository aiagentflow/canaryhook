import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDecoys } from "../canaries.js";
import { register, SETTINGS_PATH } from "../settings.js";
import { readState, writeState, STATE_DIR, type Decoy } from "../state.js";

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

export function init(root: string, options: { json: boolean; commit: boolean; force: boolean }): number {
  const existing = readState(root);
  if (existing && !options.force) {
    const message = `canaryhook is already initialized in ${root}. Use --force to replant.`;
    if (options.json) process.stdout.write(`${JSON.stringify({ ok: false, message })}\n`);
    else process.stderr.write(`${message}\n`);
    return 1;
  }

  if (existing) {
    for (const decoy of existing.decoys) {
      const path = join(root, decoy.path);
      if (existsSync(path)) unlinkSync(path);
    }
  }

  const built = buildDecoys();
  for (const { decoy, body } of built) {
    writeFileSync(join(root, decoy.path), body, "utf8");
  }

  const decoys = built.map((b) => b.decoy);
  writeState(root, {
    version: 1,
    created: new Date().toISOString(),
    decoys,
    hookRegistered: false,
  });

  const hookAdded = register(root);
  writeState(root, {
    version: 1,
    created: new Date().toISOString(),
    decoys,
    hookRegistered: true,
  });

  const ignored = options.commit ? false : updateGitignore(root, decoys);

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        planted: decoys.map((d) => d.path),
        hookRegistered: hookAdded,
        settings: SETTINGS_PATH,
        gitignoreUpdated: ignored,
      })}\n`,
    );
    return 0;
  }

  process.stdout.write(`Planted ${decoys.length} decoys:\n`);
  for (const decoy of decoys) process.stdout.write(`  ${decoy.path}  (${decoy.kind})\n`);
  process.stdout.write(
    hookAdded
      ? `\nRegistered the PreToolUse hook in ${SETTINGS_PATH}.\n`
      : `\nPreToolUse hook was already registered in ${SETTINGS_PATH}.\n`,
  );
  if (ignored) process.stdout.write("Added the decoys and .canaryhook/ to .gitignore.\n");
  if (options.commit) process.stdout.write("Left .gitignore alone, as --commit was passed.\n");
  process.stdout.write(
    "\nNothing in your project should ever read these files. If an agent does,\n" +
      "the call is blocked and recorded in .canaryhook/alerts.jsonl.\n",
  );
  return 0;
}

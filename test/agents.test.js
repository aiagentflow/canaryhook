import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseAgents, wiredAgents } from "../dist/agents/index.js";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function run(args, cwd, input) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, input, encoding: "utf8" });
}

const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), "canaryhook-")));
const state = (root) => JSON.parse(readFileSync(join(root, ".canaryhook", "canaries.json"), "utf8"));

test("parses a comma-separated agent list and reports an unknown name", () => {
  assert.deepEqual(
    parseAgents("claude, claude").agents.map((a) => a.name),
    ["claude"],
  );
  assert.deepEqual(parseAgents("claude,vim"), { unknown: "vim" });
});

test("a state file from 0.3.0 without an agents field means Claude Code", () => {
  assert.deepEqual(wiredAgents({ decoys: [] }).map((a) => a.name), ["claude"]);
});

test("init records the agents it wired, in either flag form", () => {
  for (const args of [["init", "--agents", "claude"], ["init", "--agents=claude"], ["init"]]) {
    const root = fresh();
    assert.equal(run(args, root).status, 0, args.join(" "));
    assert.deepEqual(state(root).agents, ["claude"]);
  }
});

test("init rejects an unknown or empty agent list", () => {
  const root = fresh();
  const result = run(["init", "--agents", "vim"], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown agent: vim/);
  assert.equal(run(["init", "--agents="], root).status, 1);
});

test("status reads an old state file as Claude Code", () => {
  const root = fresh();
  run(["init"], root);
  const old = state(root);
  delete old.agents;
  writeFileSync(join(root, ".canaryhook", "canaries.json"), JSON.stringify(old));
  const result = JSON.parse(run(["status", "--json"], root).stdout);
  assert.deepEqual(result.agents.map((a) => a.name), ["claude"]);
  assert.equal(result.healthy, true);
});

test("the hook falls back to Claude Code for an unknown --agent", () => {
  const root = fresh();
  run(["init"], root);
  const payload = JSON.stringify({ cwd: root, tool_name: "Read", tool_input: { file_path: ".env.backup" } });
  assert.match(run(["hook", "--agent", "vim"], root, payload).stdout, /"permissionDecision":"deny"/);
});

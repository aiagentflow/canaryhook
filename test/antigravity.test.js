import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspect } from "../dist/hook.js";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function run(args, cwd, input, env = process.env) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, input, encoding: "utf8", env });
}

function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "canaryhook-")));
  assert.equal(run(["init", "--agents", "antigravity"], root).status, 0);
  return root;
}

const config = (root) => JSON.parse(readFileSync(join(root, ".agents", "hooks.json"), "utf8"));
const call = (root, name, args) => JSON.stringify({ conversationId: "c1", workspacePaths: [root], toolCall: { name, args } });
const hook = (root, name, args) => JSON.parse(run(["hook", "--agent", "antigravity"], root, call(root, name, args)).stdout);

test("init adds a canaryhook entry to .agents/hooks.json, keeping other entries", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "canaryhook-")));
  mkdirSync(join(root, ".agents"));
  writeFileSync(join(root, ".agents", "hooks.json"), JSON.stringify({ lint: { PostToolUse: [] } }));
  run(["init"], root);
  const { canaryhook, lint } = config(root);
  assert.deepEqual(lint, { PostToolUse: [] });
  assert.equal(canaryhook.PreToolUse[0].hooks[0].command, "canaryhook hook --agent antigravity");
  assert.equal(canaryhook.SessionStart[0].command, "canaryhook session-start --agent antigravity");
  run(["clean"], root);
  assert.deepEqual(config(root), { lint: { PostToolUse: [] } });
});

test("denies a view_file of a decoy and records it", () => {
  const root = project();
  const out = hook(root, "view_file", { AbsolutePath: join(root, ".env.backup") });
  assert.equal(out.decision, "deny");
  assert.match(out.reason, /tripwire/);
  assert.equal(run(["verify"], root).status, 1);
});

test("checks run_command like a shell command, globs included", () => {
  const root = project();
  assert.equal(hook(root, "run_command", { CommandLine: "cat *.bak", Cwd: root }).decision, "deny");
  assert.equal(hook(root, "run_command", { CommandLine: "ls src", Cwd: root }).decision, "allow");
});

test("a pass is an explicit allow, which defers to the user's own rules", () => {
  const root = project();
  assert.deepEqual(hook(root, "view_file", { AbsolutePath: join(root, "README.md") }), { decision: "allow" });
  assert.deepEqual(JSON.parse(run(["hook", "--agent", "antigravity"], root, "{}").stdout), { decision: "allow" });
});

test("removing or disabling the canaryhook entry trips tamper", () => {
  for (const toolInput of [
    { TargetFile: ".agents/hooks.json", CodeContent: "{}", file_path: ".agents/hooks.json", content: "{}" },
    { file_path: ".agents/hooks.json", old_string: `"canaryhook": {`, new_string: `"canaryhook": { "enabled": false,` },
    { command: "rm .agents/hooks.json" },
  ]) {
    assert.equal(inspect([], toolInput)?.reason, "tamper", JSON.stringify(toolInput));
  }
  const root = project();
  assert.equal(hook(root, "write_to_file", { TargetFile: join(root, ".agents", "hooks.json"), CodeContent: "{}" }).decision, "deny");
});

test("status marks the output hook as not supported and stays healthy", () => {
  const root = project();
  const status = JSON.parse(run(["status", "--json"], root).stdout);
  assert.equal(status.agents[0].outputHookRegistered, null);
  assert.equal(status.healthy, true);
  assert.match(run(["status"], root).stdout, /Output hook {2}not supported/);
});

test("doctor and session start work in Antigravity's format", () => {
  const root = project();
  const bin = mkdtempSync(join(tmpdir(), "canaryhook-bin-"));
  writeFileSync(join(bin, "canaryhook"), `#!/bin/sh\nexec ${process.execPath} ${CLI} "$@"\n`);
  chmodSync(join(bin, "canaryhook"), 0o755);
  const doctor = run(["doctor", "--json"], root, undefined, { ...process.env, PATH: `${bin}:${process.env.PATH}` });
  assert.equal(doctor.status, 0, doctor.stdout);
  hook(root, "view_file", { AbsolutePath: join(root, ".env.backup") });
  const out = JSON.parse(run(["session-start", "--agent", "antigravity"], root).stdout);
  assert.match(out.injectSteps[0].systemMessage.systemMessage, /1 canary trip/);
});

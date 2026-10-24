import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspect } from "../dist/hook.js";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function run(args, cwd, input, env = process.env) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, input, encoding: "utf8", env });
}

function project(args = ["init", "--agents", "claude,cursor"]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "canaryhook-")));
  assert.equal(run(args, root).status, 0);
  return root;
}

const config = (root) => JSON.parse(readFileSync(join(root, ".cursor", "hooks.json"), "utf8"));
const tokens = (root) => JSON.parse(readFileSync(join(root, ".canaryhook", "canaries.json"), "utf8")).decoys;

function cursorCall(root, event, fields) {
  return JSON.stringify({ conversation_id: "c1", hook_event_name: event, cwd: root, workspace_roots: [root], ...fields });
}

test("init registers the Cursor hooks in .cursor/hooks.json", () => {
  const root = project();
  const { version, hooks } = config(root);
  assert.equal(version, 1);
  assert.equal(hooks.preToolUse[0].command, "canaryhook hook --agent cursor");
  assert.equal(hooks.postToolUse[0].command, "canaryhook hook --agent cursor");
  assert.equal(hooks.sessionStart[0].command, "canaryhook session-start --agent cursor");
});

test("init wires Cursor by default only when the project already has .cursor/", () => {
  assert.equal(existsSync(join(project(["init"]), ".cursor", "hooks.json")), false);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "canaryhook-")));
  mkdirSync(join(root, ".cursor"));
  run(["init"], root);
  assert.equal(config(root).hooks.preToolUse.length, 1);
});

test("keeps hooks already in .cursor/hooks.json and removes only its own on clean", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "canaryhook-")));
  mkdirSync(join(root, ".cursor"));
  writeFileSync(join(root, ".cursor", "hooks.json"), JSON.stringify({ version: 1, hooks: { preToolUse: [{ command: "other" }] } }));
  run(["init"], root);
  assert.deepEqual(config(root).hooks.preToolUse.map((h) => h.command), ["other", "canaryhook hook --agent cursor"]);
  run(["clean"], root);
  assert.deepEqual(config(root).hooks, { preToolUse: [{ command: "other" }] });
});

test("denies a decoy read through preToolUse and records it", () => {
  const root = project();
  const result = run(["hook", "--agent", "cursor"], root, cursorCall(root, "preToolUse", { tool_name: "Read", tool_input: { file_path: ".env.backup" } }));
  const out = JSON.parse(result.stdout);
  assert.equal(out.permission, "deny");
  assert.match(out.agent_message, /tripwire/);
  assert.equal(run(["verify"], root).status, 1);
});

test("allows a clean call explicitly, as Cursor blocks on empty output", () => {
  const root = project();
  const result = run(["hook", "--agent", "cursor"], root, cursorCall(root, "preToolUse", { tool_name: "Shell", tool_input: { command: "ls src" } }));
  assert.deepEqual(JSON.parse(result.stdout), { permission: "allow" });
  assert.deepEqual(JSON.parse(run(["hook", "--agent", "cursor"], root, "not json").stdout), { permission: "allow" });
});

test("postToolUse records a canary in the tool output and tells the agent", () => {
  const root = project();
  const output = JSON.stringify({ stdout: `.env.backup:AWS_ACCESS_KEY_ID=${tokens(root)[0].token}` });
  const result = run(["hook", "--agent", "cursor"], root, cursorCall(root, "postToolUse", { tool_name: "Shell", tool_input: { command: "grep -r AKIA ." }, tool_output: output }));
  assert.match(JSON.parse(result.stdout).additional_context, /fake/);
  assert.equal(run(["verify"], root).status, 1);
});

test("removing the hook from .cursor/hooks.json trips tamper", () => {
  assert.equal(inspect([], { file_path: ".cursor/hooks.json", content: `{"version":1,"hooks":{}}` })?.reason, "tamper");
  assert.equal(inspect([], { command: "rm .cursor/hooks.json" })?.reason, "tamper");
  assert.equal(inspect([], { file_path: ".cursor/hooks.json", content: `{"hooks":{"preToolUse":[{"command":"canaryhook hook --agent cursor"}]}}` }), null);
});

test("status and doctor cover Cursor", () => {
  const root = project();
  const status = JSON.parse(run(["status", "--json"], root).stdout);
  assert.deepEqual(status.agents.map((a) => a.name), ["claude", "cursor"]);
  assert.equal(status.healthy, true);
  const bin = mkdtempSync(join(tmpdir(), "canaryhook-bin-"));
  writeFileSync(join(bin, "canaryhook"), `#!/bin/sh\nexec ${process.execPath} ${CLI} "$@"\n`);
  chmodSync(join(bin, "canaryhook"), 0o755);
  const doctor = run(["doctor", "--json"], root, undefined, { ...process.env, PATH: `${bin}:${process.env.PATH}` });
  const checks = JSON.parse(doctor.stdout).checks;
  assert.ok(checks.some((c) => c.name === "Cursor: hook denies a decoy read" && c.ok));
  assert.ok(checks.some((c) => c.name === "Cursor: hook passes normal calls" && c.ok));
  assert.equal(doctor.status, 0);
});

test("session start reports past trips in Cursor's format", () => {
  const root = project();
  run(["hook", "--agent", "cursor"], root, cursorCall(root, "preToolUse", { tool_name: "Read", tool_input: { file_path: ".env.backup" } }));
  const out = JSON.parse(run(["session-start", "--agent", "cursor"], root).stdout);
  assert.match(out.additional_context, /1 canary trip/);
});

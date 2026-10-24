import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspect } from "../dist/hook.js";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function run(args, cwd, input) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, input, encoding: "utf8" });
}

function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "canaryhook-")));
  assert.equal(run(["init", "--agents", "gemini"], root).status, 0);
  return root;
}

const settings = (root) => JSON.parse(readFileSync(join(root, ".gemini", "settings.json"), "utf8"));
const call = (root, event, fields) => JSON.stringify({ session_id: "s1", hook_event_name: event, cwd: root, timestamp: "t", ...fields });
const hook = (root, event, fields) => JSON.parse(run(["hook", "--agent", "gemini"], root, call(root, event, fields)).stdout);

test("init registers BeforeTool, AfterTool and SessionStart in .gemini/settings.json, keeping other settings", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "canaryhook-")));
  mkdirSync(join(root, ".gemini"));
  writeFileSync(join(root, ".gemini", "settings.json"), JSON.stringify({ theme: "dark" }));
  run(["init"], root);
  const { theme, hooks } = settings(root);
  assert.equal(theme, "dark");
  assert.equal(hooks.BeforeTool[0].matcher, ".*");
  assert.equal(hooks.BeforeTool[0].hooks[0].command, "canaryhook hook --agent gemini");
  assert.equal(hooks.AfterTool[0].hooks[0].command, "canaryhook hook --agent gemini");
  assert.equal("matcher" in hooks.SessionStart[0], false);
  run(["clean"], root);
  assert.deepEqual(settings(root), { theme: "dark" });
});

test("denies a read_file of a decoy, under either argument name, and records it", () => {
  const root = project();
  assert.equal(hook(root, "BeforeTool", { tool_name: "read_file", tool_input: { file_path: ".env.backup" } }).decision, "deny");
  assert.equal(hook(root, "BeforeTool", { tool_name: "read_file", tool_input: { absolute_path: join(root, "deploy_key.old") } }).decision, "deny");
  assert.equal(run(["verify"], root).status, 1);
});

test("a clean call answers {}", () => {
  const root = project();
  assert.deepEqual(hook(root, "BeforeTool", { tool_name: "run_shell_command", tool_input: { command: "ls src" } }), {});
});

test("AfterTool hides a result holding a canary from the model", () => {
  const root = project();
  const { decoys } = JSON.parse(readFileSync(join(root, ".canaryhook", "canaries.json"), "utf8"));
  const out = hook(root, "AfterTool", {
    tool_name: "run_shell_command",
    tool_input: { command: "grep -r AKIA ." },
    tool_response: { llmContent: `./.env.backup:AWS_ACCESS_KEY_ID=${decoys[0].token}`, returnDisplay: "" },
  });
  assert.equal(out.decision, "deny");
  assert.match(out.reason, /fake/);
});

test("removing the hook from .gemini/settings.json trips tamper", () => {
  assert.equal(inspect([], { file_path: ".gemini/settings.json", content: `{"theme":"dark"}` })?.reason, "tamper");
  assert.equal(inspect([], { file_path: ".gemini/settings.json", old_string: `"command": "canaryhook hook --agent gemini"`, new_string: "" })?.reason, "tamper");
  assert.equal(inspect([], { file_path: ".gemini/settings.json", old_string: `"theme": "dark"`, new_string: `"theme": "light"` }), null);
});

test("session start reports past trips as additional context", () => {
  const root = project();
  hook(root, "BeforeTool", { tool_name: "read_file", tool_input: { file_path: ".env.backup" } });
  const out = JSON.parse(run(["session-start", "--agent", "gemini"], root).stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /1 canary trip/);
});

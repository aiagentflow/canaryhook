import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
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
  assert.equal(run(["init", "--agents", "codex"], root).status, 0);
  return root;
}

const config = (root) => JSON.parse(readFileSync(join(root, ".codex", "hooks.json"), "utf8"));

function codexCall(root, event, fields) {
  return JSON.stringify({ session_id: "s1", hook_event_name: event, cwd: root, model: "gpt", ...fields });
}

test("init registers the Codex hooks in .codex/hooks.json and prints the trust step", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "canaryhook-")));
  const result = run(["init", "--agents", "codex"], root);
  assert.match(result.stdout, /run \/hooks in Codex/);
  const { hooks } = config(root);
  assert.equal(hooks.PreToolUse[0].hooks[0].command, "canaryhook hook --agent codex");
  assert.equal("matcher" in hooks.PreToolUse[0], false);
  assert.equal(hooks.PostToolUse[0].hooks[0].command, "canaryhook hook --agent codex");
  assert.equal(hooks.SessionStart[0].hooks[0].command, "canaryhook session-start --agent codex");
  assert.equal(existsSync(join(root, ".claude", "settings.json")), false);
});

test("init wires Codex by default when the project has .codex/", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "canaryhook-")));
  mkdirSync(join(root, ".codex"));
  run(["init"], root);
  assert.equal(config(root).hooks.PreToolUse.length, 1);
});

test("denies a decoy read through Codex PreToolUse and records it", () => {
  const root = project();
  const out = JSON.parse(run(["hook", "--agent", "codex"], root, codexCall(root, "PreToolUse", { tool_name: "Bash", tool_input: { command: "cat .env.backup" } })).stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(run(["verify"], root).status, 1);
});

test("inspects an argv-array command like a string", () => {
  const root = project();
  const call = codexCall(root, "PreToolUse", { tool_name: "Bash", tool_input: { command: ["bash", "-lc", "cat .env*"] } });
  assert.equal(JSON.parse(run(["hook", "--agent", "codex"], root, call).stdout).hookSpecificOutput.permissionDecision, "deny");
  const clean = codexCall(root, "PreToolUse", { tool_name: "Bash", tool_input: { command: ["ls", "src"] } });
  assert.equal(run(["hook", "--agent", "codex"], root, clean).stdout, "");
});

test("PostToolUse blocks a result holding a canary", () => {
  const root = project();
  const { decoys } = JSON.parse(readFileSync(join(root, ".canaryhook", "canaries.json"), "utf8"));
  const call = codexCall(root, "PostToolUse", { tool_name: "Bash", tool_input: { command: "grep -r AKIA ." }, tool_response: `x ${decoys[0].token}` });
  assert.equal(JSON.parse(run(["hook", "--agent", "codex"], root, call).stdout).decision, "block");
});

test("disabling hooks in .codex/config.toml trips tamper", () => {
  for (const toolInput of [
    { file_path: ".codex/config.toml", content: "[features]\nhooks = false\n" },
    { command: `printf '[features]\\nhooks = false\\n' >> .codex/config.toml` },
    { command: "sed -i 's/hooks = true/hooks = false/' .codex/config.toml" },
    { file_path: ".codex/hooks.json", content: "{}" },
  ]) {
    assert.equal(inspect([], toolInput)?.reason, "tamper", JSON.stringify(toolInput));
  }
  assert.equal(inspect([], { file_path: ".codex/config.toml", content: 'model = "gpt-5"\n' }), null);
});

test("clean removes the Codex hooks", () => {
  const root = project();
  run(["clean"], root);
  assert.deepEqual(config(root), {});
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findRoot } from "../dist/state.js";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function run(args, cwd, input) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, input, encoding: "utf8" });
}

function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "canaryhook-")));
  assert.equal(run(["init"], root).status, 0);
  const sub = join(root, "src", "lib");
  mkdirSync(sub, { recursive: true });
  return { root, sub };
}

test("finds the initialized project from a nested subdirectory", () => {
  const { root, sub } = project();
  assert.equal(findRoot(sub), root);
  assert.equal(findRoot(root), root);
});

test("finds nothing outside an initialized project", () => {
  assert.equal(findRoot(mkdtempSync(join(tmpdir(), "canaryhook-"))), null);
});

test("the hook trips when the agent's cwd is a subdirectory", () => {
  const { sub } = project();
  const payload = JSON.stringify({ cwd: sub, tool_name: "Read", tool_input: { file_path: "../../.env.backup" } });
  const result = run(["hook"], sub, payload);
  assert.match(result.stdout, /"permissionDecision":"deny"/);
});

test("verify run from a subdirectory sees a trip recorded at the root", () => {
  const { root, sub } = project();
  const payload = JSON.stringify({ cwd: root, tool_name: "Read", tool_input: { file_path: ".env.backup" } });
  run(["hook"], root, payload);
  assert.equal(run(["verify"], sub).status, 1);
});

test("the output hook records a decoy read through a sweep and tells the agent", () => {
  const { root } = project();
  const { decoys } = JSON.parse(readFileSync(join(root, ".canaryhook", "canaries.json"), "utf8"));
  const payload = JSON.stringify({
    cwd: root,
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "grep -r AKIA ." },
    tool_response: { stdout: `./.env.backup:AWS_ACCESS_KEY_ID=${decoys[0].token}\n`, stderr: "" },
  });
  const result = run(["hook"], root, payload);
  assert.equal(JSON.parse(result.stdout).decision, "block");
  assert.equal(run(["verify"], root).status, 1);
});

test("the output hook stays quiet on clean output", () => {
  const { root } = project();
  const payload = JSON.stringify({
    cwd: root,
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "grep -r TODO src" },
    tool_response: { stdout: "src/a.ts:1:// TODO\n", stderr: "" },
  });
  assert.equal(run(["hook"], root, payload).stdout, "");
  assert.equal(run(["verify"], root).status, 0);
});

test("verify fails where canaryhook was never initialized", () => {
  const empty = mkdtempSync(join(tmpdir(), "canaryhook-"));
  const result = run(["verify"], empty);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not initialized/);
  assert.equal(JSON.parse(run(["verify", "--json"], empty).stdout).initialized, false);
});

test("verify passes a fresh install with no trips", () => {
  const { root } = project();
  assert.equal(run(["verify"], root).status, 0);
});

test("rejects a mistyped flag instead of ignoring it", () => {
  const { root } = project();
  const result = run(["clean", "--keep-alert"], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown option for clean: --keep-alert/);
  assert.equal(run(["status", "extra"], root).status, 1);
  assert.equal(run(["status", "--json"], root).status, 0);
});

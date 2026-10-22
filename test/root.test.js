import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
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

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HOOK_COMMAND, isRegistered, register, unregister } from "../dist/settings.js";

function project(settings) {
  const root = mkdtempSync(join(tmpdir(), "canaryhook-"));
  if (settings !== undefined) {
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify(settings, null, 2));
  }
  return root;
}

function read(root) {
  return JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
}

test("registers the hook in a project with no settings file", () => {
  const root = project();
  assert.equal(isRegistered(root), false);
  assert.equal(register(root), true);
  assert.equal(isRegistered(root), true);
  assert.equal(read(root).hooks.PreToolUse[0].hooks[0].command, HOOK_COMMAND);
});

test("registering twice is a no-op", () => {
  const root = project();
  register(root);
  assert.equal(register(root), false);
  assert.equal(read(root).hooks.PreToolUse.length, 1);
});

test("keeps hooks and settings that are already there", () => {
  const root = project({
    model: "opus",
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "other-tool" }] }],
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "formatter" }] }],
    },
  });
  register(root);
  const after = read(root);
  assert.equal(after.model, "opus");
  assert.equal(after.hooks.PostToolUse[0].hooks[0].command, "formatter");
  assert.equal(after.hooks.PreToolUse.length, 2);
  assert.equal(after.hooks.PreToolUse[0].hooks[0].command, "other-tool");
});

test("unregister leaves the other hooks untouched", () => {
  const root = project({
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "other-tool" }] }] },
  });
  register(root);
  assert.equal(unregister(root), true);
  const after = read(root);
  assert.equal(after.hooks.PreToolUse.length, 1);
  assert.equal(after.hooks.PreToolUse[0].hooks[0].command, "other-tool");
  assert.equal(isRegistered(root), false);
});

test("unregister drops the empty hooks object when it was the only hook", () => {
  const root = project();
  register(root);
  assert.equal(unregister(root), true);
  assert.deepEqual(read(root), {});
});

test("unregister reports nothing removed when the hook is not there", () => {
  assert.equal(unregister(project()), false);
  assert.equal(unregister(project({ hooks: {} })), false);
});

test("registers the session hook alongside the tool-call hook", () => {
  const root = project();
  assert.equal(register(root), true);
  const after = read(root);
  assert.equal(after.hooks.SessionStart[0].hooks[0].command, "canaryhook session-start");
  assert.equal("matcher" in after.hooks.SessionStart[0], false);
});

test("adds only the hook that is missing", () => {
  const root = project({
    hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: HOOK_COMMAND }] }] },
  });
  assert.equal(register(root), true);
  assert.equal(read(root).hooks.PreToolUse.length, 1);
  assert.equal(read(root).hooks.SessionStart.length, 1);
  assert.equal(register(root), false);
});

test("unregister removes both hooks", () => {
  const root = project();
  register(root);
  assert.equal(unregister(root), true);
  assert.deepEqual(read(root), {});
});

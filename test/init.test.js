import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { init } from "../dist/commands/init.js";
import { readState } from "../dist/state.js";

const DECOY = "credentials.json.bak";
const options = { json: true, commit: false, force: false };

function project() {
  return mkdtempSync(join(tmpdir(), "canaryhook-"));
}

function settings(root, raw) {
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), raw);
}

test("plants the decoys and registers the hook in an empty project", () => {
  const root = project();
  assert.equal(init(root, options), 0);
  const state = readState(root);
  assert.equal(state.decoys.length, 4);
  for (const decoy of state.decoys) assert.ok(existsSync(join(root, decoy.path)));
});

test("refuses to overwrite a real file sitting at a decoy path", () => {
  const root = project();
  writeFileSync(join(root, DECOY), "mine\n");
  assert.equal(init(root, options), 1);
  assert.equal(readFileSync(join(root, DECOY), "utf8"), "mine\n");
  assert.equal(readState(root), null);
});

test("refuses even under --force, so replanting cannot eat a real file", () => {
  const root = project();
  assert.equal(init(root, options), 0);
  const kept = readState(root).decoys.map((d) => d.path);
  writeFileSync(join(root, DECOY), "mine\n");
  assert.equal(init(root, { ...options, force: true }), 1);
  assert.equal(readFileSync(join(root, DECOY), "utf8"), "mine\n");
  assert.ok(kept.includes(DECOY));
});

test("leaves an unparseable settings file alone and plants nothing", () => {
  const root = project();
  settings(root, "{ not json");
  assert.equal(init(root, options), 1);
  assert.equal(readFileSync(join(root, ".claude", "settings.json"), "utf8"), "{ not json");
  assert.equal(readState(root), null);
  assert.equal(existsSync(join(root, DECOY)), false);
});

test("leaves a settings file holding a JSON array alone", () => {
  const root = project();
  settings(root, "[]");
  assert.equal(init(root, options), 1);
  assert.equal(readFileSync(join(root, ".claude", "settings.json"), "utf8"), "[]");
});

test("clean leaves a file that replaced a decoy and reports it", async () => {
  const { clean } = await import("../dist/commands/clean.js");
  const root = project();
  init(root, options);
  writeFileSync(join(root, DECOY), "mine\n");
  assert.equal(clean(root, { json: true, keepAlerts: false }), 0);
  assert.equal(readFileSync(join(root, DECOY), "utf8"), "mine\n");
  assert.equal(existsSync(join(root, ".env.backup")), false);
});

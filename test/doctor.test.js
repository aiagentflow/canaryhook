import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { doctor } from "../dist/commands/doctor.js";
import { init } from "../dist/commands/init.js";
import { readAlerts, readState } from "../dist/state.js";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

/** A canaryhook on PATH, the way a global or Homebrew install provides it. */
function shimOnPath() {
  const bin = mkdtempSync(join(tmpdir(), "canaryhook-bin-"));
  const shim = join(bin, "canaryhook");
  writeFileSync(shim, `#!/bin/sh\nexec ${process.execPath} ${DIST} "$@"\n`);
  chmodSync(shim, 0o755);
  return bin;
}

function withPath(path, run) {
  const before = process.env.PATH;
  process.env.PATH = path;
  try {
    return run();
  } finally {
    process.env.PATH = before;
  }
}

function project() {
  const root = mkdtempSync(join(tmpdir(), "canaryhook-"));
  init(root, { json: true, commit: false, force: false });
  return root;
}

test("reports not initialized before init", () => {
  assert.equal(doctor(mkdtempSync(join(tmpdir(), "canaryhook-")), { json: true }), 1);
});

test("passes every check when the hook command is reachable", () => {
  const root = project();
  const code = withPath(`${shimOnPath()}:${process.env.PATH}`, () => doctor(root, { json: true }));
  assert.equal(code, 0);
});

test("leaves no alert behind for its own probe", () => {
  const root = project();
  const code = withPath(`${shimOnPath()}:${process.env.PATH}`, () => doctor(root, { json: true }));
  assert.equal(code, 0);
  assert.deepEqual(readAlerts(root), []);
});

test("fails when the hook command is not on PATH", () => {
  const root = project();
  const code = withPath("/nonexistent-bin", () => doctor(root, { json: true }));
  assert.equal(code, 1);
});

test("fails when a decoy is gone", () => {
  const root = project();
  rmSync(join(root, readState(root).decoys[0].path));
  const code = withPath(`${shimOnPath()}:${process.env.PATH}`, () => doctor(root, { json: true }));
  assert.equal(code, 1);
});

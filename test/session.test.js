import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import { sessionStart } from "../dist/commands/session.js";
import { appendAlert } from "../dist/state.js";

function capture(run) {
  const written = [];
  const write = mock.method(process.stdout, "write", (chunk) => {
    written.push(String(chunk));
    return true;
  });
  try {
    run();
  } finally {
    write.mock.restore();
  }
  return written.join("");
}

function trip(root, at) {
  appendAlert(root, {
    at,
    reason: "decoy-read",
    decoy: ".env.backup",
    tool: "Bash",
    detail: "tool call references the decoy .env.backup",
  });
}

test("says nothing when the record is clean", () => {
  const root = mkdtempSync(join(tmpdir(), "canaryhook-"));
  assert.equal(capture(() => assert.equal(sessionStart(root), 0)), "");
});

test("hands the trips to the agent as session context", () => {
  const root = mkdtempSync(join(tmpdir(), "canaryhook-"));
  trip(root, "2026-10-14T21:53:40.809Z");
  const out = capture(() => sessionStart(root));
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
  const context = parsed.hookSpecificOutput.additionalContext;
  assert.match(context, /1 canary trip\(s\)/);
  assert.match(context, /\.env\.backup/);
  assert.match(context, /2026-10-14T21:53:40\.809Z/);
});

test("reports the newest trips first and says how many it is showing", () => {
  const root = mkdtempSync(join(tmpdir(), "canaryhook-"));
  for (const n of [1, 2, 3, 4, 5]) trip(root, `2026-10-1${n}T00:00:00.000Z`);
  const context = JSON.parse(capture(() => sessionStart(root))).hookSpecificOutput.additionalContext;
  assert.match(context, /5 canary trip\(s\).*showing the last 3/);
  assert.ok(context.indexOf("2026-10-15") < context.indexOf("2026-10-13"));
  assert.equal(context.includes("2026-10-12"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildDecoys } from "../dist/canaries.js";

test("every decoy hides its own canary in its body", () => {
  const built = buildDecoys();
  assert.equal(built.length, 4);
  for (const { decoy, body } of built) {
    assert.ok(body.includes(decoy.token), decoy.path);
  }
});

test("each canary is unique across a plant and across plants", () => {
  const tokens = [...buildDecoys(), ...buildDecoys()].map((b) => b.decoy.token);
  assert.equal(new Set(tokens).size, tokens.length);
});

test("the canaries carry the shape of the credential they imitate", () => {
  const byPath = Object.fromEntries(buildDecoys().map((b) => [b.decoy.path, b.decoy.token]));
  assert.match(byPath[".env.backup"], /^AKIA[A-Z0-9]{16}$/);
  assert.match(byPath["credentials.json.bak"], /^sk_live_[A-Za-z0-9]{24}$/);
  assert.match(byPath["deploy_key.old"], /^[A-Za-z0-9+/]{32}$/);
  assert.match(byPath["db_dump_2026.sql"], /^[A-Za-z0-9]{28}$/);
});

test("the AWS secret is base64 shaped, not an all-caps run", () => {
  const body = buildDecoys().find((b) => b.decoy.path === ".env.backup").body;
  const secret = /AWS_SECRET_ACCESS_KEY=(.+)/.exec(body)[1];
  assert.equal(secret.length, 40);
  assert.match(secret, /[a-z]/);
});

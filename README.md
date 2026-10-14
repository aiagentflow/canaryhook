# canaryhook

**Honeyfiles and canary tokens for AI coding agents.**

canaryhook plants decoy credential files that nothing in your project should ever
read, then trips the moment an agent reads one or lets a canary string leave the
machine. It is a smoke detector for AI coding sessions: no model, no signatures,
and close to zero false positives by construction.

Part of the [aiagentflow](https://aiagentflow.dev) suite.

> **Status: pre-release.** `0.0.1` reserves the name and ships the CLI surface
> only. The commands below are specified but not implemented yet. Watch the repo
> if you want the first working release.

## Why

Signature scanning fails against an agent that rewrites its own code, and the
attack surface around coding agents keeps growing: prompt injection in a fetched
page or a GitHub issue, a hostile MCP server tool, a dependency `postinstall`
script, or simply your own agent being overzealous and reading a credentials file
into its context.

canaryhook does not look at the attacker at all. The trap lives in the
environment. An attacker cannot tell a decoy credential from a real one without
reading it, and reading it is the trip.

## Planned commands

```bash
canaryhook init      # plant decoy files, register the tool-call hooks
canaryhook status    # are decoys planted, are hooks wired
canaryhook alerts    # list recorded trips (--json)
canaryhook verify    # exit non-zero if a decoy was read or a canary leaked
canaryhook clean     # remove decoys, unregister hooks
```

## How it will work

`canaryhook init` plants decoys such as `.env.backup`, `deploy_key.old`,
`db_dump_2024.sql` and `credentials.json.bak`, each holding realistic but dead
fake secrets. Nothing in your code, build, lint or test path references these
files, so a hit is almost never a false positive. The canary strings are recorded
in `.canaryhook/canaries.json`.

Two detection paths then run on every tool call:

- **Read path.** A `PreToolUse` hook watches for any tool touching a decoy path,
  whether that is a direct file read, a `grep -r`, or a `tar` of the project.
- **Exfil path.** The same hook checks whether a canary string appears in any
  outgoing tool input: a shell argument, a fetch URL or body, a file write, a
  commit message. You do not have to enumerate every way a file can be read, only
  notice the value leaving.

On a trip, canaryhook blocks the call, prints which decoy and which tool, appends
to `.canaryhook/alerts.jsonl`, and exits non-zero so it fails in CI too.

Decoys are added to `.gitignore` by default. Use `--commit` to track them.

## Limits

canaryhook detects, it does not prevent. An attacker that ignores the decoys is
not caught, and a targeted one that reads only the real `.env` walks past. It is
a smoke detector, not a lock. Its value is that it costs nothing to run, needs no
model, and stays quiet enough that you leave it installed.

## License

MIT

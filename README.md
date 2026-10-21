# canaryhook

**Honeyfiles and canary tokens for AI coding agents.**

canaryhook plants decoy credential files that nothing in your project should ever
read, then blocks and records the moment an agent reads one or lets a canary
string leave the machine. It is a smoke detector for AI coding sessions: no
model, no signatures, and close to zero false positives by construction.

Part of the [aiagentflow](https://aiagentflow.dev) suite.
Website: **[aiagentflow.dev/canaryhook](https://aiagentflow.dev/canaryhook)**

<p align="center">

https://github.com/user-attachments/assets/878c35aa-248c-4cdc-af04-54934a792e02

</p>

<p align="center">
  <strong>canaryhook init</strong><br>
  <img src="assets/demos/demo-init.gif" alt="canaryhook init demo" width="640">
</p>

<p align="center">
  <strong>the trip</strong>: a credential hunt, denied and recorded<br>
  <img src="assets/demos/demo-trip.gif" alt="canaryhook trip demo" width="640">
</p>

## Install

```bash
npm install -g canaryhook
cd /your/project
canaryhook init
```

Or with Homebrew:

```bash
brew install aiagentflow/tap/canaryhook
```

`init` plants four decoys, registers a `PreToolUse` hook and a `SessionStart`
hook in `.claude/settings.json` (merging with hooks you already have), and adds
the decoys plus `.canaryhook/` to `.gitignore`.

## Commands

```bash
canaryhook init      # plant decoys, register the hook
canaryhook status    # are decoys planted, is the hook wired
canaryhook alerts    # list recorded trips
canaryhook doctor    # fire a test payload through the hook to prove it is wired
canaryhook verify    # exit non-zero if anything tripped (for CI)
canaryhook clean     # remove decoys, unregister the hook
```

Flags: `--json` on every command, `--commit` to track decoys in git instead of
ignoring them, `--force` to replant, `--keep-alerts` on clean.

## Why

Signature scanning fails against an agent that rewrites its own code, and the
attack surface around coding agents keeps growing: prompt injection in a fetched
page or a GitHub issue, a hostile MCP server tool, a dependency `postinstall`
script, or simply your own agent being overzealous and reading a credentials file
into its context, where it then lands in a transcript you push somewhere.

canaryhook does not look at the attacker at all. The trap lives in the
environment. An attacker cannot tell a decoy credential from a real one without
reading it, and reading it is the trip.

## How it works

`canaryhook init` plants these, each holding a unique, realistic, dead fake
secret:

| File | Bait |
| --- | --- |
| `.env.backup` | AWS-shaped access key and secret |
| `credentials.json.bak` | Stripe-shaped live secret key |
| `deploy_key.old` | OpenSSH private key block |
| `db_dump_2026.sql` | API token in an INSERT statement |

Nothing in your code, build, lint or test path references these files, so a hit
is almost never a false positive. The canary strings are recorded in
`.canaryhook/canaries.json`, which is itself watched.

Two detection paths then run on every tool call:

- **Read path.** The hook trips when a call names a decoy path, whether that is
  `Read` with a `file_path`, a shell `cat`, or anything else that mentions it.
- **Exfil path.** The hook trips when a canary string appears anywhere in the
  call's input: a shell argument, a fetch URL or body, a file write, a commit
  message. It matches the string as written, lowercased, base64 or hex encoded,
  so wrapping the value on the way out does not hide it. You do not have to
  enumerate every way a file can be read, only notice the value leaving.

On a trip, canaryhook returns a `deny` decision so the tool call never runs,
tells the agent the file was a tripwire and not to retry, and appends to
`.canaryhook/alerts.jsonl`:

```json
{"at":"2026-10-14T21:53:40.809Z","reason":"canary-exfil","decoy":".env.backup","tool":"Bash","detail":"canary string from .env.backup appears in the tool call"}
```

Recorded trips are read back to the agent at the start of the next session, so
a trip you were not watching for does not sit unnoticed in the file.

A malformed hook payload never blocks a call, so a broken install fails open
rather than wedging your session. Failing open means a broken install is a
quiet one, so `canaryhook doctor` runs the registered hook command for real,
with a planted payload on stdin, and tells you whether the deny came back.

## CI

```yaml
- run: npx canaryhook verify
```

## Limits

canaryhook detects, it does not prevent. An attacker that ignores the decoys is
not caught, and a targeted one that reads only the real `.env` walks past. A
sweep like `grep -r AKIA .` reads the decoys without naming them, so it only
trips on the exfil path, when a canary string shows up in a later call. It is a
smoke detector, not a lock. Its value is that it costs nothing to run, needs no
model, and stays quiet enough that you leave it installed.

## License

MIT

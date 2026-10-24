# Changelog

## 0.4.0

### Added

- Support for Cursor, Codex CLI, Antigravity CLI and Gemini CLI alongside Claude Code. `init --agents claude,cursor,codex,antigravity,gemini` chooses which to wire; by default it wires Claude Code plus any agent whose config folder the project already has. See the Agents section of the README for each agent's config file and caveats.
- `status` and `doctor` report every wired agent, and `clean` removes canaryhook's hooks from all of them.
- The tamper check covers every agent's hook config, and `hooks = false` in `.codex/config.toml`.

### Changed

- `.canaryhook/canaries.json` records the agents `init` wired. A state file from 0.3.0 without that field still means Claude Code.

## 0.3.0

Run `canaryhook init --force` on an existing install to add the `PostToolUse` hook.

### Added

- A `PostToolUse` hook checks each tool's output for canary strings, so a sweep like `grep -r AKIA .` that reads a decoy without naming it is recorded and the agent is told the value is fake.
- The hook trips on tampering: deleting or rewriting `.canaryhook/`, running `canaryhook clean`, removing the hook from the settings, or setting `disableAllHooks`. These are denied and recorded as `tamper`.
- Shell globs that expand to a decoy, like `cat .env*` or `grep key *.bak`, trip the read path.

### Fixed

- The hook and every command except `init` find the project from a subdirectory. Before, an agent working in `src/` was not guarded at all, and `verify` run there reported no trips.
- `verify` fails where canaryhook was never initialized, instead of reporting a clean record. A CI checkout has no record, so the old CI step could never fail; the README now shows `init` before the agent step.
- Unknown flags and arguments are rejected instead of ignored, so `clean --keep-alert` no longer deletes the alerts it meant to keep.

### Changed

- `status` reports the `PostToolUse` hook and counts it towards healthy.

## 0.2.0

### Added

- `canaryhook doctor` pipes a planted payload through the registered hook command and checks the deny comes back, so an install where `canaryhook` is not on the hook's PATH no longer looks healthy while watching nothing.
- A `SessionStart` hook reports outstanding trips to the agent at the start of the next session. `init` registers it alongside the `PreToolUse` hook; run `canaryhook init --force` on an existing install to add it.
- The exfil path catches canary strings that are base64, base64url or hex encoded, or lowercased.

### Fixed

- `init` no longer overwrites a real file sitting at a decoy path, and `init --force` and `clean` only delete files that still hold their canary.
- A `.claude/settings.json` that is not a JSON object is left alone with an error, instead of being replaced with canaryhook's hook only.
- Decoy paths only trip when they stand on their own, so `notes/.env.backup.md` or `.env.backups` no longer trip, and editing `.gitignore` no longer trips the read path.

### Changed

- Decoy values use realistic alphabets: the AWS secret and the private key body are base64, the Stripe and API keys are mixed case.
- `status` reports the `SessionStart` hook and counts it towards healthy.

## 0.1.0

First release: `init`, `status`, `alerts`, `verify`, `clean` and the `PreToolUse` hook.

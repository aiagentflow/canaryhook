# Changelog

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

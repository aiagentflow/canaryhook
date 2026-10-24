---
id: TASK-4
title: Support Codex CLI
status: To Do
assignee: []
created_date: '2026-10-24 05:41'
labels:
  - multi-agent
dependencies:
  - TASK-2
references:
  - 'https://learn.chatgpt.com/docs/hooks'
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Register PreToolUse, PostToolUse and SessionStart in .codex/hooks.json (same shape as Claude). Codex accepts hookSpecificOutput.permissionDecision. Project hooks only run once trusted, so init and doctor tell the user to run /hooks in Codex. Handle tool_input.command as a string or an array. Protect .codex/hooks.json and a hooks = false feature flag in .codex/config.toml in the tamper check.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A decoy read through Codex PreToolUse is denied and recorded
- [ ] #2 An array command is inspected like a string
- [ ] #3 init prints the trust step
- [ ] #4 Disabling hooks in .codex/config.toml trips tamper
<!-- AC:END -->

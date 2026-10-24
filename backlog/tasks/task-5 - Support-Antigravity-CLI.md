---
id: TASK-5
title: Support Antigravity CLI
status: Done
assignee: []
created_date: '2026-10-24 05:41'
updated_date: '2026-10-24 05:54'
labels:
  - multi-agent
dependencies:
  - TASK-2
references:
  - 'https://antigravity.google/docs/hooks/'
priority: medium
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Register PreToolUse, PostToolUse and SessionStart under a canaryhook key in .agents/hooks.json. Payload is camelCase: toolCall.name, toolCall.args (CommandLine, AbsolutePath, TargetFile, CodeContent), workspacePaths. PreToolUse needs a decision on every call: allow on pass, deny with reason on a trip. SessionStart reports through injectSteps. Protect .agents/hooks.json in the tamper check.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A view_file of a decoy is denied and recorded
- [x] #2 run_command CommandLine is checked like a shell command, globs included
- [x] #3 A pass prints decision allow
- [x] #4 Removing or disabling the canaryhook entry trips tamper
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PostToolUse payloads carry no tool output (only error), so the output check is not registered for Antigravity; status shows it as not supported.
<!-- SECTION:NOTES:END -->

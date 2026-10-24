---
id: TASK-3
title: Support Cursor
status: Done
assignee: []
created_date: '2026-10-24 05:41'
updated_date: '2026-10-24 05:50'
labels:
  - multi-agent
dependencies:
  - TASK-2
references:
  - 'https://cursor.com/docs/agent/hooks'
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Register preToolUse, postToolUse and sessionStart in .cursor/hooks.json (version 1). Cursor blocks the action on empty or invalid output from a permission hook, so a pass must print {"permission":"allow"}. Deny prints permission deny with user_message and agent_message. Root comes from cwd or workspace_roots. Protect .cursor/hooks.json in the tamper check.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A read of a decoy through Cursor's preToolUse is denied and recorded
- [x] #2 A clean call prints an explicit allow
- [x] #3 postToolUse catches a canary in tool_output
- [x] #4 Removing the hook from .cursor/hooks.json trips tamper
<!-- AC:END -->

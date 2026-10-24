---
id: TASK-6
title: Support Gemini CLI
status: Done
assignee: []
created_date: '2026-10-24 05:41'
updated_date: '2026-10-24 05:56'
labels:
  - multi-agent
dependencies:
  - TASK-2
references:
  - 'https://geminicli.com/docs/hooks/reference/'
priority: low
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Gemini CLI is now for paid API keys and enterprise only, but still in use. Register BeforeTool, AfterTool and SessionStart in .gemini/settings.json. Deny prints decision deny with reason; AfterTool can hide a result with decision deny; SessionStart uses hookSpecificOutput.additionalContext. Protect the hooks entry in the tamper check.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A read_file of a decoy is denied and recorded
- [x] #2 AfterTool catches a canary in tool_response.llmContent
- [x] #3 Removing the hook from .gemini/settings.json trips tamper
<!-- AC:END -->

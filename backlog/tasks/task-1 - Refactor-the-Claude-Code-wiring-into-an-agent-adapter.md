---
id: TASK-1
title: Refactor the Claude Code wiring into an agent adapter
status: To Do
assignee: []
created_date: '2026-10-24 05:41'
labels:
  - multi-agent
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Move the Claude-specific parts (settings path, hook registration, payload parsing, deny/output/session response shapes) behind an Agent interface in src/agents/, so other agents can be added without touching the detection code. No behavior change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 src/agents/claude.ts holds everything Claude-specific
- [ ] #2 hook, session-start, init, status, doctor and clean go through the adapter
- [ ] #3 Existing tests pass unchanged
<!-- AC:END -->

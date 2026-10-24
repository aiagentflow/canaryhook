---
id: TASK-2
title: 'Add --agents selection to init, status, doctor and clean'
status: To Do
assignee: []
created_date: '2026-10-24 05:41'
labels:
  - multi-agent
dependencies:
  - TASK-1
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
init takes --agents claude,cursor,... and records the chosen agents in canaries.json; by default it wires Claude plus any agent whose config dir already exists in the project. hook and session-start take --agent <name>; without it they mean claude, so existing installs keep working.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 init --agents writes only the chosen agents' configs
- [ ] #2 status and doctor report each wired agent
- [ ] #3 clean unregisters every wired agent
- [ ] #4 Old state files without an agents field read as claude
<!-- AC:END -->

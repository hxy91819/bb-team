---
name: team-members
description: Look up or change trusted team member profiles and explicit identities through bb team. Use when the user asks about member names, avatars, initialization or team timezone.
---

Run `bb team --help` for current commands. Use `--json` for bounded results;
follow member cursors only as needed. Resolve duplicate names before choosing
an ID. Writes use an explicitly selected member ID; creating a member requires
the selected administrator ID. This is trusted self-selection, not login.

Thread attribution, grouping and activity queries are not connected in this
baseline. Report that boundary when asked for those capabilities.

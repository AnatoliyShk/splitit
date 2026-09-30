---
name: group-commit
description: Group Splitit's uncommitted changes into logical commits and create them locally, without pushing. commit-grouper (Sonnet) plans the groups, commit-describer (Haiku) writes each message, and commit-grouper creates the commits. Use when the user asks to commit their changes, split changes into commits, or run /group-commit.
---

# Group and commit changes

Subagents can't start other subagents, so you (the main session) run this chain. Never push, and never ask an agent to push.

## 1. Check there is something to commit
Run `git status --porcelain=v1 -uall`. If it is empty, tell the user there is nothing to commit and stop. If the folder isn't a git repo, stop and say so.

## 2. Plan the groups
Spawn `commit-grouper` in the foreground with the prompt `Mode: plan.` and any scope the user gave, for example "only backend/". Wait for its GROUP / EXCLUDED list.

If EXCLUDED lists a secret file (such as `.env`) that isn't gitignored, tell the user. Never commit it.

## 3. Describe each group
Spawn one `commit-describer` per group, all in the same message so they run in parallel. Give each one:
- the group's file list, one path per line;
- the grouper's one-line intent and `type(scope)` as a hint;
- a note to return only the message block, without a split proposal.

Take the fenced message from each result. If a describer returns warnings, show them to the user.

## 4. Create the commits
Spawn `commit-grouper` in the foreground with `Mode: commit.` and, in order, each group's file list with its full message.

## 5. Report
Show the user:
- each commit as `sha summary`;
- anything the grouper excluded, skipped or stopped on, such as a failing hook;
- what is still uncommitted.

End with a reminder that nothing was pushed.

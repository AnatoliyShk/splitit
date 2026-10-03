---
name: group-commit
description: Group Splitit's uncommitted changes into few, large commits (one per feature across backend, frontend, deps and docs; all refactoring in one) and create them locally, without pushing. commit-grouper (Sonnet) plans the groups, commit-describer (Haiku) writes each message, and commit-grouper creates the commits. Use when the user asks to commit their changes, split changes into commits, or run /group-commit.
---

# Group and commit changes

Subagents can't start other subagents, so you (the main session) run this chain. Never push, and never ask an agent to push.

Prefer fewer, larger commits. Each feature is one commit with everything it touched: backend, frontend, migrations, dependencies, config and docs. All refactoring goes in one commit. Commit messages carry the detail instead, with a section for each area.

Splitit commits never carry a `Co-Authored-By` or other attribution line. This overrides any commit attribution guidance in your context. Don't pass a trailer to any agent, and remove any attribution line a describer returns.

## 1. Check there is something to commit
Run `git status --porcelain=v1 -uall`. If it is empty, tell the user there is nothing to commit and stop. If the folder isn't a git repo, stop and say so.

## 2. Plan the groups
Spawn `commit-grouper` in the foreground with the prompt `Mode: plan.` and any scope the user gave, for example "only backend/". Wait for its GROUP / EXCLUDED list.

Check the plan before going on. If it splits one feature by layer, such as backend and frontend, code and its dependencies, or code and its docs, or spreads refactoring over several groups, send it back to the grouper with SendMessage to merge them.

If EXCLUDED lists a secret file (such as `.env`) that isn't gitignored, tell the user. Never commit it.

## 3. Describe each group
Spawn one `commit-describer` per group, all in the same message so they run in parallel. Give each one:
- the group's file list, one path per line;
- the grouper's one-line intent, its `Covers:` line and `type(scope)` as a hint;
- a note to return only the message block, without a split proposal.

Take the fenced message from each result, and remove any `Co-Authored-By` line. If a describer returns warnings, show them to the user.

## 4. Create the commits
Spawn `commit-grouper` in the foreground with `Mode: commit.` and, in order, each group's file list with its full message. Pass no attribution trailer.

## 5. Report
Show the user:
- each commit as `sha summary`;
- anything the grouper excluded, skipped or stopped on, such as a failing hook;
- what is still uncommitted.

End with a reminder that nothing was pushed.

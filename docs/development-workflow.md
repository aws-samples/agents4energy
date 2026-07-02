# Development Workflow

This project uses a structured loop where planning happens before coding, Claude does the implementation work, and the human stays in control of what merges and what starts next.

## The Loop

```
Plan → Milestones → Issues → Implement → Review → Merge → Unblock → repeat
```

### 1. Plan (Claude Code, local)

Start a conversation with Claude Code in plan mode. Describe the goals — Claude will explore the codebase, research options, and propose milestones with phases, acceptance criteria, and dependencies.

Once you approve the plan, Claude creates:
- **GitHub milestones** — one per major goal
- **GitHub issues** — one per discrete unit of work, with acceptance criteria in the body
- **Blocked-by relationships** — so the dependency graph is explicit from day one
- **A GitHub Project** — with Status and Labels columns, linked to the repo

The project has an `Actionable` view filtered to `no:blocked-by` — this is your work queue. Everything visible there can be started immediately.

### 2. Implement (Claude via GitHub Action)

Open any unblocked issue. Add a comment mentioning `@claude` describing what you want done. The `claude.yml` GitHub Action picks this up and:

1. Removes the `needs-review` label (if present)
2. Creates a branch and starts working
3. Commits and pushes frequently
4. Opens a PR when done
5. Adds the `needs-review` label to the issue

The PR is always the active work item once it exists. Review the PR, not the issue.

**Tips for `@claude` comments:**
- Be specific about acceptance criteria — Claude will use the issue body as context
- If Claude gets interrupted, comment `@claude, please continue` on the issue or PR
- You can comment on the PR itself with `@claude` to request changes without leaving the PR

### 3. Review

PRs are always actionable — they contain written code waiting for your eyes. In the project view, open PRs show **In Review** status.

Review the diff, test the deployed preview (if branch CI/CD is configured), and either:
- **Merge** — if it looks good
- **Comment with `@claude`** — if changes are needed; Claude will push a new commit

### 4. Merge and Unblock

When you merge a PR:
- The source issue closes automatically (if the PR body contains `Closes #N`)
- Any issues that were blocked by that issue now appear in the `no:blocked-by` project view
- Those newly unblocked issues become your next work queue

Pick the next issue from the `no:blocked-by` view and repeat from step 2.

---

## Project Board Setup

The GitHub Project has two key fields beyond the defaults:

| Field | Values | Meaning |
|---|---|---|
| **Status** | Blocked, Ready, In Progress, In Review, Needs Triggering, Done | Where the item is in the loop |
| **Labels** | `needs-review`, `in-progress` | Set automatically by `claude.yml` |

**Views to create:**
- **Actionable** — filter `no:blocked-by`, your daily driver
- **Needs Review** — filter `label:needs-review`, Claude has responded and is waiting on you

Status transitions happen automatically via the GitHub Projects "Item labeled" workflow:
- `needs-review` label added → Status = `Needs Triggering`

---

## Dependency Rules

- Only **issues** block other issues — PRs are never listed as blockers
- A PR's source issue is its blocker proxy: if issue #26 blocks #31, and PR #30 implements #26, then #31 is effectively waiting on PR #30 — but the relationship is expressed as issue-to-issue
- Sub-issues (parent/child) are used for decomposition within a feature; blocked-by is used for sequencing across features

---

## When to Re-plan

Come back to Claude Code in plan mode when:
- A milestone is complete and you need to scope the next one
- An unexpected finding during implementation changes the approach
- You want to add new goals that weren't in the original plan

Claude will read the existing milestones and issues, identify what's done, and propose the next set of work without duplicating what's already tracked.

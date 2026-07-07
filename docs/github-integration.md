# GitHub Integration

Agents in this project can be invoked by @mentioning them in GitHub issue and PR comments. The integration uses GitHub Actions with a dedicated IAM user — long-term credentials are stored as GitHub secrets and used to sign requests directly to the AgentCore runtime.

## How it works

```
issue_comment event
    │
    ▼
GitHub Actions workflow  (.github/workflows/agent-mention.yml)
    │
    ├─ Parse @agent-<slug> mention from comment body
    ├─ SigV4-sign createChatSession mutation → AppSync (IAM auth)
    │    returns chatSessionId
    ├─ Post live-link comment: "Watch live: <APP_URL>/chat-handler?sessionId=<id>"
    ├─ SigV4-sign POST /runtimes/<arn>/invocations?qualifier=DEFAULT  (sync: true)
    │    payload includes sessionId, githubToken, githubRepo, githubBranch
    │
    ▼
AgentCore runtime  (agent/handler/agent.py — FastAPI + Strands)
    │  clones repo, runs agent, publishes AG-UI events to AppSync subscription
    │  returns {"sessionId": "...", "response": "..."}
    │
    ▼
octokit.rest.issues.createComment  (final reply posted as github-actions[bot])
```

The runtime runs in **sync mode** (`sync: true` in the invocation payload): it processes the prompt inline and returns the full response in the HTTP body instead of publishing AG-UI events to AppSync. This avoids the need for a WebSocket subscription in the Actions runner.

## Setup

Run the setup script (from repo root):

```bash
npx tsx scripts/setup-github-integration.ts
# interactive repo picker

npx tsx scripts/setup-github-integration.ts --repo owner/name
# non-interactive
```

The script:

1. Reads the AgUiHandler runtime ARN from `web/deployment-info.json`
2. Creates the IAM user `github-actions-agent-invoker` if it doesn't exist and upserts an inline policy:
   ```json
   {
     "Effect": "Allow",
     "Action": "bedrock-agentcore:InvokeAgentRuntime",
     "Resource": ["<runtimeArn>", "<runtimeArn>/runtime-endpoint/*"]
   }
   ```
3. Reuses the existing IAM access key (the secret is already in GitHub from a prior run) or creates a new one if none exist
4. Sets the `INVOKE_AGENT_RUNTIME_ARN` Actions variable and `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` secrets on the target repo
5. Pushes `scripts/github-agent-invoke.ts` and `.github/workflows/agent-mention.yml` to the target repo via the GitHub Contents API

### Prerequisites

- `gh` CLI authenticated (`gh auth login`)
- AWS CLI configured with admin credentials for the deployment account
- `pnpm deploy` completed (`web/deployment-info.json` must exist)

## Repository variables and secrets

| Name | Type | Description |
|------|------|-------------|
| `INVOKE_AGENT_RUNTIME_ARN` | Variable | ARN of the AgUiHandler AgentCore runtime |
| `APPSYNC_ENDPOINT` | Variable | AppSync GraphQL endpoint URL (for creating chat sessions) |
| `APP_URL` | Variable | Base URL of the deployed web app (optional, enables live-chat links) |
| `AWS_ACCESS_KEY_ID` | Secret | Access key ID for `github-actions-agent-invoker` IAM user |
| `AWS_SECRET_ACCESS_KEY` | Secret | Secret key for `github-actions-agent-invoker` IAM user |

`AWS_REGION` is hardcoded to the deployment region in the generated workflow.

Pass `--app-url https://your-app.example.com` to `setup-github-integration.ts` to set `APP_URL`.

## Workflow

The generated `.github/workflows/agent-mention.yml`:

```yaml
name: Agent @mention handler

on:
  issue_comment:
    types: [created]
  issues:
    types: [assigned]

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  invoke-agent:
    runs-on: ubuntu-latest
    if: |
      github.event.sender.type != 'Bot' && (
        github.event_name == 'issues' ||
        contains(github.event.comment.body, '@agent-')
      )
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install script dependencies
        run: npm install --no-save tsx @octokit/rest @smithy/signature-v4 @aws-crypto/sha256-js
      - name: Invoke agent and post reply
        env:
          INVOKE_AGENT_RUNTIME_ARN: ${{ vars.INVOKE_AGENT_RUNTIME_ARN }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_REGION: us-east-1
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_BASE_REF: ${{ github.event.repository.default_branch }}
        run: npx tsx scripts/github-agent-invoke.ts
```

## SigV4 signing

`scripts/github-agent-invoke.ts` uses `@smithy/signature-v4` to sign the runtime invocation:

- Service: `bedrock-agentcore`
- Region: `us-east-1`
- Endpoint: `https://bedrock-agentcore.us-east-1.amazonaws.com/runtimes/<encoded-arn>/invocations`
- Query param `qualifier=DEFAULT` is separated from the path before signing (required for correct signature)
- The `host` header is stripped from signed headers before calling `fetch` (fetch injects it automatically from the URL)

## Prompt construction

The invoke script builds a prompt that includes structured GitHub context:

```
You are acting on behalf of a GitHub user in the repository <owner>/<repo>.

CONTEXT:
- Repository: <owner>/<repo>
- Default branch: <branch>
- Issue #<N>: <title>
- Issue body: <first 500 chars>
- Triggered by: @<sender>

USER REQUEST:
<text after @agent-<slug>>

If your response involves code changes, create a new branch off <branch>,
commit the changes, and open a pull request. Reference issue #<N> in the PR description.
```

## Loop prevention

The workflow's `if` condition excludes `Bot` sender types. The script additionally checks `sender.login.endsWith('[bot]')` before processing, so the bot never responds to its own comments.

## Trigger strategies

| Trigger | Event | How to target an agent |
|---------|-------|------------------------|
| @mention in comment | `issue_comment.created` | Include `@agent-<slug>` in comment body |
| Issue assignment | `issues.assigned` | Issue body must contain `@agent-<slug>` |
| PR comment | `issue_comment.created` | Comment on a PR (same event, `issue.pull_request` field is present) |

## Workspace cloning

When the invocation payload includes `githubToken`, `githubRepo`, and `githubBranch`, the runtime prepares a workspace **before** the agent runs:

1. **`gh` CLI is authenticated** via `gh auth login --with-token` (token piped to stdin, stored in `~/.config/gh/hosts.yml`). The agent never sees the token.
2. **`gh auth setup-git`** is run to register `gh` as git's HTTPS credential helper, so all plain git operations authenticate automatically without any token in URLs or config.
3. **Repository is cloned** into `/workspace/<owner>/<repo>` on the default branch, or updated with `git fetch` + `git reset --hard` if the directory already exists. No token appears in `.git/config`.
4. The workspace path and usage hints are injected into the agent's system prompt. The agent decides whether to create a branch, and can push any branch (new or existing) directly:
   ```
   git -C /workspace/<owner>/<repo> checkout -b my-feature-branch
   git -C /workspace/<owner>/<repo> push origin my-feature-branch
   gh pr create --repo <owner>/<repo> --base main --head my-feature-branch --title '...' --body '...'
   ```

The `GITHUB_TOKEN` from Actions has `contents: write` and `pull-requests: write` permissions (declared in the workflow). Its default expiry is the job timeout (up to 6 hours).

## Sync mode in the runtime

`agent/handler/agent.py` checks for `sync: true` in the invocation payload:

```python
if sync_mode:
    response_text = await _run_agent(session_id, prompt, system_prompt, model_id, ...)
    return JSONResponse({"sessionId": session_id, "response": response_text})
```

In sync mode, AppSync event publishing is skipped gracefully when credentials are unavailable (boto3 returns `None` from `get_credentials()` in environments without an IAM role). The Strands agent still calls Bedrock normally using the container's execution role.

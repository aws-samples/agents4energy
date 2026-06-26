"""
AgentCore Runtime Handler — AG-UI over AppSync

Receives invocations from the invoke-handler Lambda, runs a Strands agent,
and publishes AG-UI events to AppSync as they arrive so the browser's
GraphQL subscription sees real-time streaming.

Required env vars (injected by the AgentCore runtime execution role):
  APPSYNC_HTTP_ENDPOINT  — https://<id>.appsync-api.<region>.amazonaws.com/graphql
  AGENTCORE_MEMORY_ID    — e.g. default_MyHarnessMemory-zz6wfiFFUs
  AWS_REGION             — e.g. us-east-1 (auto-set by the runtime)

The container uses instance-profile / task-role credentials, so boto3 signs
all requests with SigV4 automatically.

Context management is fully delegated to Strands' SummarizingConversationManager
with proactive_compression=True — it compresses at ~70% of the model context
window automatically, no custom summarization code required.
"""

import json
import os
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path

import boto3
import httpx
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from fastapi import BackgroundTasks, FastAPI, Request
from fastapi.responses import JSONResponse
from strands import Agent
from strands.agent.conversation_manager import SummarizingConversationManager
from strands.tools import tool

APPSYNC_ENDPOINT = os.environ.get("APPSYNC_HTTP_ENDPOINT", "")
MEMORY_ID = os.environ.get("AGENTCORE_MEMORY_ID", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# The harness stores conversation events under this actor ID. Using the same
# value means listSessionMessages on the frontend finds handler sessions too.
ACTOR_ID = "default"

# Maximum number of recent memory events to seed into the agent's message list.
MAX_HISTORY_EVENTS = 40

app = FastAPI()

PUBLISH_MUTATION = """
mutation PublishAgentEvent(
  $sessionId: String!
  $eventType: String!
  $messageId: String!
  $delta: String
  $done: Boolean
) {
  publishAgentEvent(
    sessionId: $sessionId
    eventType: $eventType
    messageId: $messageId
    delta: $delta
    done: $done
  ) {
    sessionId
    eventType
    messageId
    delta
    done
  }
}
"""


def _boto_session() -> boto3.Session:
    return boto3.Session(region_name=AWS_REGION)


def _signed_headers(session: boto3.Session, body: bytes) -> dict[str, str]:
    """Return SigV4-signed headers for an AppSync HTTP POST."""
    creds = session.get_credentials().get_frozen_credentials()
    request = AWSRequest(
        method="POST",
        url=APPSYNC_ENDPOINT,
        data=body,
        headers={"Content-Type": "application/json"},
    )
    SigV4Auth(creds, "appsync", AWS_REGION).add_auth(request)
    return dict(request.headers)


async def publish_event(
    session_id: str,
    event_type: str,
    message_id: str,
    delta: str | None = None,
    done: bool = False,
) -> None:
    """Publish one AG-UI event to AppSync (fire-and-continue)."""
    if not APPSYNC_ENDPOINT:
        return

    try:
        body = json.dumps({
            "query": PUBLISH_MUTATION,
            "variables": {
                "sessionId": session_id,
                "eventType": event_type,
                "messageId": message_id,
                "delta": delta,
                "done": done,
            },
        }).encode()

        session = _boto_session()
        creds = session.get_credentials()
        if creds is None:
            print(f"[handler] AppSync publish skipped: no AWS credentials available")
            return
        headers = _signed_headers(session, body)

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(APPSYNC_ENDPOINT, content=body, headers=headers)
            if resp.status_code != 200:
                print(f"[handler] AppSync publish failed {resp.status_code}: {resp.text[:200]}")
    except Exception as exc:  # noqa: BLE001
        print(f"[handler] AppSync publish error ({event_type}): {exc}")


def _save_memory_event(session_id: str, role: str, text: str) -> None:
    """Write a conversational event to AgentCore memory (synchronous)."""
    if not MEMORY_ID:
        return
    try:
        client = _boto_session().client("bedrock-agentcore", region_name=AWS_REGION)
        client.create_event(
            memoryId=MEMORY_ID,
            actorId=ACTOR_ID,
            sessionId=session_id,
            eventTimestamp=datetime.now(timezone.utc),
            payload=[{
                "conversational": {
                    "role": role.upper(),
                    "content": {"text": text},
                }
            }],
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[handler] memory write failed ({role}): {exc}")


def _fetch_history_as_messages(session_id: str, after_summary: bool = False) -> list[dict]:
    """
    Return recent turns from AgentCore memory as Strands-compatible message dicts,
    oldest-first. When after_summary=True the frontend has already filtered events
    to post-summary turns, but we still cap at MAX_HISTORY_EVENTS.
    """
    if not MEMORY_ID:
        return []
    try:
        client = _boto_session().client("bedrock-agentcore", region_name=AWS_REGION)
        resp = client.list_events(
            memoryId=MEMORY_ID,
            actorId=ACTOR_ID,
            sessionId=session_id,
            includePayloads=True,
            maxResults=MAX_HISTORY_EVENTS,
        )
        messages = []
        for e in resp.get("events", []):
            for payload in e.get("payload", []):
                conv = payload.get("conversational")
                if not conv:
                    continue
                role = conv.get("role", "").lower()
                text = conv.get("content", {}).get("text", "")
                if role in ("user", "assistant") and text:
                    messages.append({
                        "role": role,
                        "content": [{"text": text}],
                    })
        return messages
    except Exception as exc:  # noqa: BLE001
        print(f"[handler] history fetch failed: {exc}")
        return []


@app.get("/ping")
async def ping():
    return {"status": "Healthy"}


@tool
def shell(command: str, cwd: str = "/") -> str:
    """
    Execute a shell command and return its combined stdout+stderr output.
    Use this to run git commands, gh CLI, tests, build scripts, or any shell operation.

    Args:
        command: Shell command to execute (passed to /bin/sh -c).
        cwd: Working directory (default: /).

    Returns:
        Combined stdout and stderr output, with exit code appended if non-zero.
    """
    result = subprocess.run(
        command,
        shell=True,
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=120,
    )
    output = (result.stdout + result.stderr).strip()
    if result.returncode != 0:
        output += f"\n[exit code {result.returncode}]"
    return output or "(no output)"


def _prepare_workspace(github_repo: str, github_branch: str, github_token: str) -> str:
    """
    1. Authenticates the gh CLI with the token (stored in ~/.config/gh/).
    2. Clones or updates /workspace/<owner>/<repo> on the requested branch.
       The token is used only transiently in the remote URL and is stripped
       from .git/config immediately after; the agent never sees it.
    Returns the absolute path to the workspace directory.
    """
    workspace = Path("/workspace") / github_repo
    workspace.parent.mkdir(parents=True, exist_ok=True)

    # Authenticate gh CLI, then wire it up as git's credential helper.
    # After setup-git, plain HTTPS git operations use the stored token automatically.
    subprocess.run(
        ["gh", "auth", "login", "--hostname", "github.com", "--with-token"],
        input=github_token,
        text=True,
        capture_output=True,
        check=True,
    )
    subprocess.run(["gh", "auth", "setup-git"], capture_output=True, check=True)

    clone_url = f"https://github.com/{github_repo}.git"

    def _git(*args: str) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=str(workspace),
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"git {args[0]} failed: {result.stderr.strip()}")
        return result.stdout.strip()

    if (workspace / ".git").exists():
        _git("fetch", "origin")
        _git("checkout", github_branch)
        _git("reset", "--hard", f"origin/{github_branch}")
    else:
        subprocess.run(
            ["git", "clone", "--branch", github_branch, "--single-branch", clone_url, str(workspace)],
            capture_output=True,
            text=True,
            check=True,
        )

    print(f"[handler] workspace ready: {workspace} (branch: {github_branch})")
    return str(workspace)


async def _run_agent(
    session_id: str,
    prompt: str,
    system_prompt: str | None,
    model_id: str | None,
    existing_summary: str | None,
    github_token: str | None = None,
    github_repo: str | None = None,
    github_branch: str | None = None,
) -> str:
    """Seed history + summary, run agent with managed compaction, publish AG-UI events."""
    message_id = str(uuid.uuid4())

    # Clone or update the repo before the agent runs so tools like
    # code_interpreter can execute tests, type-checks, etc. against real code.
    workspace_path: str | None = None
    if github_token and github_repo and github_branch:
        try:
            workspace_path = _prepare_workspace(github_repo, github_branch, github_token)
        except Exception as exc:  # noqa: BLE001
            print(f"[handler] workspace setup failed: {exc}")

    # Fetch only the post-summary events so we don't re-process turns already
    # captured in the AgentCore-managed summary.
    history = _fetch_history_as_messages(session_id, after_summary=existing_summary is not None)

    _save_memory_event(session_id, "user", prompt)
    await publish_event(session_id, "user_message", message_id, delta=prompt)
    await publish_event(session_id, "run_started", message_id)
    await publish_event(session_id, "text_message_start", message_id)

    # Prepend the AgentCore summary to the system prompt so the model has full
    # context. The summary covers turns before the last compaction; `history`
    # covers turns after it.
    effective_system = system_prompt or ""
    if existing_summary:
        effective_system = (
            f"<conversation_summary>\n{existing_summary}\n</conversation_summary>\n"
            "The above summarises the conversation so far. Use it as context.\n\n"
            + effective_system
        ).strip()

    if workspace_path:
        workspace_block = (
            f"\n\n<github_workspace>\n"
            f"Repository {github_repo} is checked out at {workspace_path} (currently on branch: {github_branch}).\n"
            f"Use this directory when running tests, type checks, or making code changes.\n"
            f"Git is configured to authenticate automatically — you can push new or existing branches without credentials, e.g.:\n"
            f"  git -C {workspace_path} checkout -b my-feature-branch\n"
            f"  git -C {workspace_path} push origin my-feature-branch\n"
            f"The gh CLI is also authenticated — use it to open pull requests, e.g.:\n"
            f"  gh pr create --repo {github_repo} --base {github_branch} --head my-feature-branch --title '...' --body '...'\n"
            f"</github_workspace>"
        )
        effective_system = (effective_system + workspace_block).strip()

    agent_kwargs: dict = {
        "conversation_manager": SummarizingConversationManager(
            proactive_compression=True,
        ),
        "messages": history,
        "tools": [shell],
    }
    if effective_system:
        agent_kwargs["system_prompt"] = effective_system
    if model_id:
        agent_kwargs["model"] = model_id

    agent = Agent(**agent_kwargs)
    full_response = ""

    try:
        async for event in agent.stream_async(prompt):
            if isinstance(event, dict):
                delta = event.get("data") or event.get("text") or ""
            elif isinstance(event, str):
                delta = event
            else:
                delta = str(event)

            if delta:
                full_response += delta
                await publish_event(session_id, "text_message_content", message_id, delta=delta)
    except Exception as exc:  # noqa: BLE001
        await publish_event(session_id, "run_error", message_id, delta=str(exc), done=True)
        return str(exc)

    # Persist assistant turn to memory before publishing the terminal events,
    # so the memory is committed by the time the browser sees run_finished.
    if full_response:
        _save_memory_event(session_id, "assistant", full_response)

    await publish_event(session_id, "text_message_end", message_id, done=True)
    await publish_event(session_id, "run_finished", message_id, done=True)
    return full_response


@app.post("/invocations")
async def invocations(request: Request, background_tasks: BackgroundTasks):
    payload = await request.json()

    session_id: str = payload.get("sessionId") or str(uuid.uuid4())
    prompt: str = payload.get("prompt", "")
    system_prompt: str | None = payload.get("systemPrompt")
    model_id: str | None = payload.get("modelId")
    existing_summary: str | None = payload.get("summary")
    sync_mode: bool = bool(payload.get("sync", False))
    github_token: str | None = payload.get("githubToken")
    github_repo: str | None = payload.get("githubRepo")
    github_branch: str | None = payload.get("githubBranch")

    if not prompt:
        return JSONResponse({"error": "prompt is required"}, status_code=400)

    if sync_mode:
        # Synchronous mode: run agent inline and return the full response.
        # Used by the GitHub Actions integration which can't receive AppSync events.
        response_text = await _run_agent(
            session_id, prompt, system_prompt, model_id, existing_summary,
            github_token, github_repo, github_branch,
        )
        return JSONResponse({"sessionId": session_id, "response": response_text})

    # FastAPI BackgroundTasks runs after the response is sent but before the
    # ASGI scope closes, so the task is guaranteed to complete.
    background_tasks.add_task(
        _run_agent, session_id, prompt, system_prompt, model_id, existing_summary,
        github_token, github_repo, github_branch,
    )

    return JSONResponse({"sessionId": session_id})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)

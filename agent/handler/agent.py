"""
AgentCore Runtime Handler — AG-UI over AppSync

Receives invocations from the invoke-handler Lambda, runs a Strands agent,
and publishes AG-UI events to AppSync as they arrive so the browser's
GraphQL subscription sees real-time streaming.

Required env vars (injected by the AgentCore runtime execution role):
  APPSYNC_HTTP_ENDPOINT  — https://<id>.appsync-api.<region>.amazonaws.com/graphql
  AWS_REGION             — e.g. us-east-1 (auto-set by the runtime)

The container uses instance-profile / task-role credentials, so boto3 signs
AppSync requests with SigV4 automatically.
"""

import asyncio
import json
import os
import uuid

import boto3
import httpx
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from strands import Agent

APPSYNC_ENDPOINT = os.environ.get("APPSYNC_HTTP_ENDPOINT", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

app = FastAPI()

# Mutation used to push each AG-UI event to AppSync subscribers.
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


def _get_session() -> boto3.Session:
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
    """Fire-and-forget: publish one AG-UI event to AppSync."""
    if not APPSYNC_ENDPOINT:
        return  # local dev without AppSync

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

    session = _get_session()
    headers = _signed_headers(session, body)

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(APPSYNC_ENDPOINT, content=body, headers=headers)
        if resp.status_code != 200:
            # Log but don't crash — streaming must continue even if one publish fails.
            print(f"[handler] AppSync publish failed {resp.status_code}: {resp.text[:200]}")


@app.get("/ping")
async def ping():
    return {"status": "Healthy"}


async def _run_agent(session_id: str, prompt: str, system_prompt: str | None, model_id: str | None) -> None:
    """Background task: run agent and publish AG-UI events to AppSync."""
    message_id = str(uuid.uuid4())

    await publish_event(session_id, "run_started", message_id)
    await publish_event(session_id, "text_message_start", message_id)

    agent_kwargs: dict = {}
    if system_prompt:
        agent_kwargs["system_prompt"] = system_prompt
    if model_id:
        agent_kwargs["model"] = model_id

    agent = Agent(**agent_kwargs)

    try:
        async for event in agent.stream_async(prompt):
            if isinstance(event, dict):
                delta = event.get("data") or event.get("text") or ""
            elif isinstance(event, str):
                delta = event
            else:
                delta = str(event)

            if delta:
                await publish_event(session_id, "text_message_content", message_id, delta=delta)
    except Exception as exc:  # noqa: BLE001
        await publish_event(session_id, "run_error", message_id, delta=str(exc), done=True)
        return

    await publish_event(session_id, "text_message_end", message_id, done=True)
    await publish_event(session_id, "run_finished", message_id, done=True)


@app.post("/invocations")
async def invocations(request: Request):
    payload = await request.json()

    session_id: str = payload.get("sessionId") or str(uuid.uuid4())
    prompt: str = payload.get("prompt", "")
    system_prompt: str | None = payload.get("systemPrompt")
    model_id: str | None = payload.get("modelId")

    if not prompt:
        return JSONResponse({"error": "prompt is required"}, status_code=400)

    # Fire-and-forget: return sessionId immediately so the AppSync HTTP resolver
    # can echo it back to the browser.  Events arrive on the subscription.
    asyncio.create_task(_run_agent(session_id, prompt, system_prompt, model_id))

    return JSONResponse({"sessionId": session_id})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)

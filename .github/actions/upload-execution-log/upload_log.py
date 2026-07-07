#!/usr/bin/env python3
"""Upload the Claude Code execution log to CloudWatch Logs.

Run as a GitHub composite-action step. All inputs arrive via environment
variables (set by action.yml) rather than being interpolated into the source,
so untrusted context values can never be used to build a shell command.
"""
import json, os, subprocess, time, sys, tempfile

LOG_GROUP = os.environ.get("LOG_GROUP", "/github-actions/claude-code")
region = os.environ.get("AWS_REGION", "us-east-1")
retention_days = os.environ.get("RETENTION_DAYS", "30")
log_file = os.environ.get("LOG_FILE", "/home/runner/work/_temp/claude-execution-output.json")

repo = os.environ.get("GITHUB_REPOSITORY", "unknown").replace("/", "-")
run_id = os.environ.get("GITHUB_RUN_ID", "0")
LOG_STREAM = f"{repo}/{run_id}"


def aws(*args):
    return subprocess.run(["aws", "--region", region] + list(args),
                          capture_output=True, text=True)


def put_log_events(batch):
    # Pass the batch via a temp file (file://) rather than inline on the
    # command line — a large --log-events value overflows the OS argument
    # limit (Errno 7: Argument list too long).
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
        json.dump(batch, tf)
        path = tf.name
    try:
        return aws("logs", "put-log-events", "--log-group-name", LOG_GROUP,
                   "--log-stream-name", LOG_STREAM,
                   "--log-events", f"file://{path}")
    finally:
        os.unlink(path)


aws("logs", "create-log-group", "--log-group-name", LOG_GROUP)
aws("logs", "put-retention-policy", "--log-group-name", LOG_GROUP,
    "--retention-in-days", retention_days)
aws("logs", "create-log-stream", "--log-group-name", LOG_GROUP,
    "--log-stream-name", LOG_STREAM)

if not os.path.exists(log_file):
    print("No execution log found")
    sys.exit(0)

with open(log_file) as f:
    lines = [l for l in f.read().splitlines() if l.strip()]

MAX_BATCH_BYTES = 900_000
MAX_EVENT_BYTES = 250_000

events = []
ts = int(time.time() * 1000)
for i, line in enumerate(lines):
    events.append({"timestamp": ts + i, "message": line[:MAX_EVENT_BYTES]})

batch, batch_size = [], 0
for event in events:
    size = len(event["message"].encode()) + 26
    if batch and (batch_size + size > MAX_BATCH_BYTES or len(batch) >= 10000):
        r = put_log_events(batch)
        if r.returncode != 0:
            print(f"Warning: {r.stderr}", file=sys.stderr)
        batch, batch_size = [], 0
    batch.append(event)
    batch_size += size

if batch:
    r = put_log_events(batch)
    if r.returncode != 0:
        print(f"Warning: {r.stderr}", file=sys.stderr)

print(f"Uploaded {len(events)} events to {LOG_GROUP}/{LOG_STREAM}")

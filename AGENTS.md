<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Invoking the agent

Use `scripts/invoke.ts` to call the deployed AgentCore runtime from the command line:

```
npx tsx scripts/invoke.ts "Your prompt here"
```

- Reads test credentials from `scripts/.env.local` (`TEST_USER_EMAIL` / `TEST_USER_PASSWORD`)
- Authenticates against the Cognito user pool via `USER_PASSWORD_AUTH`
- Reads the runtime ARN from `web/deployment-info.json`
- Streams the response to stdout, printing text deltas as they arrive

`scripts/.env.local` is covered by the root `.gitignore` and must never be committed.

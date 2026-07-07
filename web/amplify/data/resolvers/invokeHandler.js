/**
 * Stub resolver for invokeHandler — replaced at deploy time by the AgentCore CDK stack
 * with an HTTP resolver that calls bedrock-agentcore directly.
 * This stub echoes sessionId back so Amplify schema synthesis succeeds.
 */
export function request(ctx) {
  return { payload: ctx.args };
}

export function response(ctx) {
  return { sessionId: ctx.args.sessionId };
}

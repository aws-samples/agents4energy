/**
 * AppSync NONE data source resolver for publishAgentEvent.
 * Passes the mutation arguments straight through as the result so that
 * the onAgentEvent subscription receives the event.
 */
export function request(ctx) {
  return { payload: ctx.args };
}

export function response(ctx) {
  return ctx.result;
}

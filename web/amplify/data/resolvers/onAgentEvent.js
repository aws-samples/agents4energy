/**
 * AppSync NONE data source resolver for the onAgentEvent subscription.
 * Returns nothing — the subscription events are driven by publishAgentEvent mutations.
 */
export function request(ctx) {
  return { payload: null };
}

export function response(ctx) {
  return ctx.result;
}

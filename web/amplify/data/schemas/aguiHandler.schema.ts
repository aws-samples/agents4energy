import { a } from '@aws-amplify/backend';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const resolversDir = resolve(__dirname, '../resolvers');

/**
 * AG-UI Handler Schema
 *
 * AgentEvent       — a single AG-UI event published by the handler runtime
 * publishAgentEvent — mutation the handler calls to push events to subscribers
 * onAgentEvent     — subscription the browser uses to receive real-time events
 *
 * Note: invokeHandler is NOT declared here. It is created as a raw CDK
 * CfnResolver in backend.ts (HTTP data source, reads ctx.env.AGUI_RUNTIME_ARN)
 * so that Amplify CFn fully owns the resolver and there is no ownership
 * conflict with the post-deploy script.
 */
export const aguiHandlerSchema = a.schema({

  AgentEvent: a.customType({
    sessionId: a.string().required(),
    // AG-UI event types: run_started | text_message_start | text_message_content |
    //                    text_message_end | run_finished | run_error
    eventType: a.string().required(),
    messageId: a.string().required(),
    // Populated for text_message_content events.
    delta: a.string(),
    // True on the terminal event for this message (text_message_end, run_finished, run_error).
    done: a.boolean(),
  }),

  // Mutation the runtime container calls to stream events to the frontend.
  // The Lambda execution role publishes via AppSync IAM auth.
  publishAgentEvent: a
    .mutation()
    .arguments({
      sessionId: a.string().required(),
      eventType: a.string().required(),
      messageId: a.string().required(),
      delta: a.string(),
      done: a.boolean(),
    })
    .returns(a.ref('AgentEvent'))
    .authorization((allow) => [allow.authenticated()])
    .handler(
      a.handler.custom({
        dataSource: 'NONE_DS',
        entry: `${resolversDir}/publishAgentEvent.js`,
      }),
    ),

  // Subscription the browser uses to receive AG-UI events for a session.
  onAgentEvent: a
    .subscription()
    .for(a.ref('publishAgentEvent'))
    .arguments({ sessionId: a.string().required() })
    .authorization((allow) => [allow.authenticated()])
    .handler(
      a.handler.custom({
        dataSource: 'NONE_DS',
        entry: `${resolversDir}/onAgentEvent.js`,
      }),
    ),

  // Result type returned synchronously when the browser kicks off a run.
  InvokeHandlerResult: a.customType({
    sessionId: a.string().required(),
  }),

  // Mutation the browser calls to start an agent run.
  // Amplify owns the schema field (so AppSync knows the type); the resolver is
  // created/updated by scripts/extract-deployment-info.js (HTTP data source,
  // reads ctx.env.AGUI_RUNTIME_ARN) after agentcore deploy.
  invokeHandler: a
    .mutation()
    .arguments({
      sessionId: a.string().required(),
      prompt: a.string().required(),
      systemPrompt: a.string(),
      modelId: a.string(),
    })
    .returns(a.ref('InvokeHandlerResult'))
    .handler(
      a.handler.custom({
        dataSource: 'NONE_DS',
        entry: `${resolversDir}/invokeHandler.js`,
      }),
    )
    .authorization((allow) => [allow.authenticated()]),
});

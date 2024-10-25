import type { Schema } from '@/../amplify/data/resource';
export type Message = Schema["ChatMessage"]["type"] | {
content: string;
role: "ai"|"human"|"tool";
createdAt: string;
trace?: string
tool_name?: string;
tool_call_id?: string;
tool_calls?: string;
chatSessionId?: string;
};

// export type Message = {
//     content: string;
//     owner?: string;
//     role: string;
//     createdAt?: string;
//     trace?: string
//     tool_name?: string;
//     tool_call_id?: string;
//     tool_calls?: string;
//     chatSessionId?: string;
//   }